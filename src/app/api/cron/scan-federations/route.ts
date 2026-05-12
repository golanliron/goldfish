import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = await scanFederations();
  return Response.json(results);
}

// Sources to scan for new federations
const FEDERATION_SOURCES = [
  {
    name: 'JFNA Federation Finder',
    url: 'https://www.jewishfederations.org/federation-finder',
    region: 'northeast',
  },
  {
    name: 'European Jewish Association',
    url: 'https://ejassociation.eu/members/',
    region: 'europe',
  },
  {
    name: 'ECAJ Australia',
    url: 'https://www.ecaj.org.au/about/',
    region: 'australia',
  },
  {
    name: 'World Jewish Congress Communities',
    url: 'https://www.worldjewishcongress.org/en/about/communities',
    region: 'global',
  },
  {
    name: 'JFC-UIA Canada',
    url: 'https://www.jfcuia.org/member-federations/',
    region: 'canada',
  },
];

interface FederationItem {
  name: string;
  description?: string;
  website?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_name?: string;
  contact_role?: string;
  city?: string;
  country?: string;
  region?: string;
  has_israel_grants?: boolean;
}

async function scanFederations() {
  const supabase = createAdminClient();
  let totalNew = 0;
  let totalSkipped = 0;
  const errors: string[] = [];

  for (const source of FEDERATION_SOURCES) {
    try {
      const res = await fetch(source.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        errors.push(`${source.name}: HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();
      const items = await extractFederations(html.slice(0, 30000), source.name, source.region);

      for (const item of items) {
        if (!item.name || item.name.length < 5) continue;

        // Check if already exists
        const { data: existing } = await supabase
          .from('companies')
          .select('id')
          .ilike('name', `%${item.name.slice(0, 40)}%`)
          .limit(1);

        if (existing && existing.length > 0) {
          totalSkipped++;
          continue;
        }

        const interests = ['federation', 'jewish', 'international'];
        if (item.region) interests.push(item.region);
        if (item.has_israel_grants) interests.push('israel_grants');
        if (item.country === 'UK' || item.country === 'England') interests.push('uk', 'europe');
        if (item.country === 'France') interests.push('france', 'europe');
        if (item.country === 'Germany') interests.push('germany', 'europe');
        if (item.country === 'Australia') interests.push('australia');
        if (item.country === 'Canada') interests.push('canada');

        await supabase.from('companies').insert({
          name: item.name,
          company_type: 'fund',
          description: item.description || null,
          interests,
          website: item.website || null,
          contact_email: item.contact_email || null,
          contact_phone: item.contact_phone || null,
          contact_name: item.contact_name || null,
          contact_role: item.contact_role || null,
          active: true,
        });
        totalNew++;
      }
    } catch (e) {
      errors.push(`${source.name}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  // Log scan
  try {
    await supabase.from('scan_logs').insert({
      new_items: totalNew,
      skipped: totalSkipped,
      errors: errors.length > 0 ? errors : null,
      sources_scanned: FEDERATION_SOURCES.length,
    });
  } catch { /* table might not exist */ }

  return {
    scanned: FEDERATION_SOURCES.length,
    new_federations: totalNew,
    skipped: totalSkipped,
    errors,
    timestamp: new Date().toISOString(),
  };
}

async function extractFederations(html: string, sourceName: string, defaultRegion: string): Promise<FederationItem[]> {
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    system: `אתה מחלץ פדרציות יהודיות וארגוני קהילה יהודיים מדפי HTML.
חוקים:
1. חלץ רק פדרציות/ארגוני קהילה יהודיים — לא אנשים פרטיים, לא בתי כנסת, לא ארגוני נוער בודדים.
2. כל פדרציה צריכה שם ומיקום לפחות.
3. אם יש מייל או אתר — כלול אותם.

החזר JSON בלבד — מערך של אובייקטים:
{
  "name": "שם הפדרציה",
  "description": "תיאור קצר — מה הם עושים, מה הם מממנים",
  "website": "URL לאתר",
  "contact_email": "מייל ישיר",
  "contact_phone": "טלפון",
  "contact_name": "שם איש קשר",
  "contact_role": "תפקיד",
  "city": "עיר",
  "country": "מדינה",
  "region": "${defaultRegion}",
  "has_israel_grants": true/false
}

אם אין פדרציות בדף — החזר מערך ריק [].`,
    messages: [{
      role: 'user',
      content: `מקור: ${sourceName}\n\n${html}`,
    }],
    max_tokens: 4000,
  });

  const text = res.content[0].type === 'text' ? res.content[0].text : '[]';
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];

  try {
    return JSON.parse(jsonMatch[1]!.trim());
  } catch {
    return [];
  }
}
