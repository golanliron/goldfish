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

// Sources to scan
const SOURCES = [
  {
    name: 'שתיל - קולות קוראים',
    url: 'https://www.shatil.org.il/calls',
    type: 'html' as const,
  },
  {
    name: 'מיזם אטלס',
    url: 'https://app.atlas-grants.com/grants',
    type: 'api' as const,
  },
  {
    name: 'ביטוח לאומי - קולות קוראים',
    url: 'https://www.btl.gov.il/Grants/Pages/default.aspx',
    type: 'html' as const,
  },
  {
    name: 'ג׳וינט ישראל',
    url: 'https://www.jdc.org.il/calls-for-proposals/',
    type: 'html' as const,
  },
  {
    name: 'קרן שלם',
    url: 'https://www.shalemfund.org.il/',
    type: 'html' as const,
  },
  {
    name: 'מפעל הפיס',
    url: 'https://www.pfrp.co.il/',
    type: 'html' as const,
  },
  {
    name: 'Grants.gov RSS',
    url: 'https://www.grants.gov/rss/GG_NewOppByCategory.xml',
    type: 'rss' as const,
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
  const errors: string[] = [];

  for (const source of SOURCES) {
    try {
      // Fetch the page
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

      // Use Claude to extract grant opportunities from the page
      const items = await extractOpportunities(html.slice(0, 30000), source.name, source.url);

      for (const item of items) {
        if (!item.title || item.title.length < 5) continue;

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

        // Insert new opportunity
        await supabase.from('opportunities').insert({
          title: item.title,
          description: item.description || null,
          funder: item.funder || source.name,
          deadline: item.deadline || null,
          url: item.url || source.url,
          categories: item.categories || [],
          target_populations: item.target_populations || [],
          active: true,
          source: source.name,
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
    errors,
    timestamp: new Date().toISOString(),
  };
}

async function extractOpportunities(html: string, sourceName: string, sourceUrl: string): Promise<ScannedItem[]> {
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    system: `אתה מחלץ קולות קוראים ומענקים מדפי HTML.
החזר JSON בלבד — מערך של אובייקטים.
כל אובייקט:
{
  "title": "שם הקול קורא",
  "description": "תיאור קצר (עד 200 תווים)",
  "funder": "שם הגוף המממן",
  "deadline": "YYYY-MM-DD או null",
  "url": "לינק ישיר אם קיים",
  "categories": ["education", "welfare", "health", "employment", "community", "culture", "environment", "technology", "housing", "legal", "security", "other"],
  "target_populations": ["youth", "youth_at_risk", "women", "elderly", "disabilities", "new_immigrants", "arab", "haredi", "students", "south_residents", "north_residents", "periphery_residents", "other"]
}

סווג לפי קטגוריות ואוכלוסיות בהתאם לתוכן. אם אין קולות קוראים בדף — החזר מערך ריק [].
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
