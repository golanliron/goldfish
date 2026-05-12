import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Vercel Cron or manual trigger with secret
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = await scanAllSources();
  return Response.json(results);
}

// Sources to scan — Israeli grant aggregators and government sites
const SOURCES = [
  {
    name: 'שתיל - קולות קוראים',
    url: 'https://www.shatil.org.il/calls',
    type: 'html' as const,
  },
  {
    name: 'ביטוח לאומי - קולות קוראים',
    url: 'https://www.btl.gov.il/Funds/kolotkorim/Pages/default.aspx',
    type: 'html' as const,
  },
  {
    name: 'ג׳וינט ישראל',
    url: 'https://www.jdc.org.il/calls-for-proposals/',
    type: 'html' as const,
  },
  {
    name: 'רשות החדשנות',
    url: 'https://innovationisrael.org.il/kol-kore/',
    type: 'html' as const,
  },
  {
    name: 'gov.il קולות קוראים',
    url: 'https://www.gov.il/he/Departments/DynamicCollectors/kolkore-list',
    type: 'html' as const,
  },
  {
    name: 'מפעל הפיס - תרבות',
    url: 'https://culture.pais.co.il/',
    type: 'html' as const,
  },
  {
    name: 'קקל',
    url: 'https://www.kkl.org.il/about-us/tenders/call-for-proposals/',
    type: 'html' as const,
  },
  {
    name: 'משרד החינוך מו"פ',
    url: 'https://mop.education/open-call/',
    type: 'html' as const,
  },
  {
    name: 'תקומה - שיקום העוטף',
    url: 'https://govextra.gov.il/minisite-new/tkuma-zmani/home/tenders-new/',
    type: 'html' as const,
  },
];

interface ScannedItem {
  title: string;
  description?: string;
  funder?: string;
  deadline?: string;
  url?: string;
  categories?: string[];
  target_populations?: string[];
}

async function scanAllSources() {
  const supabase = createAdminClient();
  let totalNew = 0;
  let totalSkipped = 0;
  let deactivated = 0;
  const errors: string[] = [];

  // === Step 1: Cleanup expired opportunities ===
  const today = new Date().toISOString().split('T')[0];
  const { data: expired } = await supabase
    .from('opportunities')
    .update({ active: false })
    .lt('deadline', today)
    .eq('active', true)
    .not('deadline', 'is', null)
    .select('id');
  deactivated = expired?.length || 0;

  // === Step 2: Scan all sources ===
  for (const source of SOURCES) {
    try {
      const res = await fetch(source.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        errors.push(`${source.name}: HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();
      const items = await extractOpportunities(html.slice(0, 30000), source.name, source.url);

      for (const item of items) {
        if (!item.title || item.title.length < 8) continue;

        // Skip foundation profiles (not actual grants)
        if (!item.deadline && !item.description && !item.url &&
            (item.title.startsWith('קרן ') || item.title.length < 15)) {
          continue;
        }

        // Check if already exists (by title similarity)
        const { data: existing } = await supabase
          .from('opportunities')
          .select('id')
          .ilike('title', `%${item.title.slice(0, 40)}%`)
          .limit(1);

        if (existing && existing.length > 0) {
          totalSkipped++;
          continue;
        }

        await supabase.from('opportunities').insert({
          title: item.title,
          description: item.description || null,
          funder: item.funder || null,
          deadline: item.deadline || null,
          url: item.url || null,
          categories: item.categories || [],
          target_populations: item.target_populations || [],
          active: true,
          source: source.name,
          type: 'grant',
        });
        totalNew++;
      }
    } catch (e) {
      errors.push(`${source.name}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  // Log scan run (ignore if table doesn't exist)
  try {
    await supabase.from('scan_logs').insert({
      new_items: totalNew,
      skipped: totalSkipped,
      errors: errors.length > 0 ? errors : null,
      sources_scanned: SOURCES.length,
    });
  } catch { /* table might not exist */ }

  return {
    scanned: SOURCES.length,
    new_opportunities: totalNew,
    skipped: totalSkipped,
    deactivated_expired: deactivated,
    errors,
    timestamp: new Date().toISOString(),
  };
}

async function extractOpportunities(html: string, sourceName: string, sourceUrl: string): Promise<ScannedItem[]> {
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    system: `אתה מחלץ קולות קוראים ומענקים מדפי HTML.
חוקים קריטיים:
1. חלץ רק קולות קוראים/מענקים/תמיכות פתוחים — לא פרופילים של קרנות, לא דפי מידע כלליים.
2. אם הכותרת היא רק שם קרן (כמו "קרן הדסה") בלי פרטי קול קורא — דלג.
3. חייב לינק ישיר לדף הקול הקורא. לינק לדף הבית של קרן = לא מספיק.

החזר JSON בלבד — מערך של אובייקטים:
{
  "title": "שם הקול קורא המלא",
  "description": "תיאור קצר (עד 200 תווים)",
  "funder": "שם הגוף המממן (לא שם הקול קורא)",
  "deadline": "YYYY-MM-DD או null",
  "url": "לינק ישיר לדף הקול קורא",
  "categories": ["education", "welfare", "health", "employment", "community", "culture", "environment", "technology", "housing", "legal", "sport", "other"],
  "target_populations": ["youth", "youth_at_risk", "young_adults", "women", "elderly", "disabilities", "immigrants", "arab", "haredi", "soldiers", "students", "periphery_residents", "other"]
}

אם אין קולות קוראים בדף — החזר מערך ריק [].
לא להמציא. רק מה שרואים בטקסט.`,
    messages: [{
      role: 'user',
      content: `מקור: ${sourceName}\nURL: ${sourceUrl}\n\n${html}`,
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
