/**
 * GET /api/cron/backfill-grant-urls?batch=20
 *
 * For every active opportunity without application_url:
 * 1. Detect if the source is gov.il (Merkava/portal) — handle deep scan
 * 2. Search the web for the direct application form URL
 * 3. Validate the URL is live (HEAD request)
 * 4. Save to opportunities.application_url + funder_intelligence.application_url (cross-org reuse)
 *
 * Multi-tenant: Links are stored globally — all orgs benefit from one discovery.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { webSearch } from '@/lib/ai/web-search';
import { geminiCall } from '@/lib/ai/gemini';

export const maxDuration = 300;

function isGovSource(url: string | null, source: string | null): boolean {
  if (!url && !source) return false;
  const combined = `${url || ''} ${source || ''}`.toLowerCase();
  return (
    combined.includes('gov.il') ||
    combined.includes('merkava') ||
    combined.includes('kolzchut') ||
    combined.includes('btl.gov') ||
    combined.includes('most.gov') ||
    combined.includes('mof.gov') ||
    combined.includes('moital.gov') ||
    combined.includes('education.gov') ||
    combined.includes('welfare.gov') ||
    combined.includes('misrad')
  );
}

function classifyUrlSource(url: string | null, source: string | null): string {
  if (isGovSource(url, source)) return 'gov';
  const combined = `${url || ''} ${source || ''}`.toLowerCase();
  if (combined.includes('foundation') || combined.includes('jfna') || combined.includes('federation')) return 'foundation';
  return 'other';
}

async function validateUrl(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timeout);
    return res.ok || res.status === 405;
  } catch {
    return false;
  }
}

async function extractApplicationUrl(
  title: string,
  funder: string | null,
  existingUrl: string | null,
  searchSnippets: string,
  isGov: boolean
): Promise<string | null> {
  const govHint = isGov
    ? '\nמדובר בקול קורא ממשלתי. חפש בעיקר לינקים לפורטל התמיכות (taktziv.mof.gov.il, pras.most.gov.il, מערכות משרדים ממשלתיים). שים לב ל-PDF שמכיל לינק לפורטל הגשה.'
    : '';

  const prompt = `אתה מומחה גיוס משאבים. מהמידע הבא על קול קורא, חלץ את הלינק הישיר לדף הגשת הבקשה.${govHint}

כותרת: "${title}"
גוף מממן: "${funder || 'לא ידוע'}"
${existingUrl ? `לינק כללי קיים: ${existingUrl}` : ''}

תוצאות חיפוש:
---
${searchSnippets.slice(0, 5000)}
---

כללים:
- application_url חייב לפנות ישירות לדף הגשה/טופס/פורטל, לא לעמוד בית כללי
- אם הוא זהה ל-${existingUrl} — החזר null
- לינקים ממשלתיים חייבים להיות של 2025-2026
- אם אין לינק ספציפי ברור — החזר null

ענה רק בפורמט JSON:
{ "application_url": "https://..." } או { "application_url": null }`;

  try {
    const raw = await geminiCall(prompt, 200, 0.1);
    const m = raw.match(/\{[\s\S]*?\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const url = parsed.application_url;
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
    if (existingUrl && url === existingUrl) return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const batchSize = Math.min(30, parseInt(url.searchParams.get('batch') || '15'));
  const supabase = createAdminClient();

  const { data: opps } = await supabase
    .from('opportunities')
    .select('id, title, funder, url, source, description')
    .eq('active', true)
    .is('application_url', null)
    .not('url', 'is', null)
    .order('scraped_at', { ascending: false })
    .limit(batchSize);

  if (!opps || opps.length === 0) {
    return NextResponse.json({ ok: true, message: 'No opportunities to enrich', processed: 0 });
  }

  let enriched = 0;
  let skipped = 0;

  // Pre-load known application URLs from funder_intelligence (cross-org reuse)
  const funderNames = [...new Set(opps.map((o: Record<string, string | null>) => o.funder).filter(Boolean))] as string[];
  const fiCache = new Map<string, string>();
  if (funderNames.length > 0) {
    const { data: fiRows } = await supabase
      .from('funder_intelligence')
      .select('funder_name, application_url')
      .in('funder_name', funderNames)
      .not('application_url', 'is', null);
    for (const fi of (fiRows || [])) {
      if (fi.application_url) fiCache.set(fi.funder_name, fi.application_url);
    }
  }

  for (const opp of opps) {
    try {
      // Fast path: reuse from funder_intelligence
      if (opp.funder && fiCache.has(opp.funder)) {
        await supabase.from('opportunities').update({ application_url: fiCache.get(opp.funder) }).eq('id', opp.id);
        enriched++;
        continue;
      }

      const isGov = isGovSource(opp.url, opp.source);
      const urlSource = classifyUrlSource(opp.url, opp.source);

      const query = isGov
        ? `"${opp.title}" ${opp.funder || ''} פורטל הגשה מערכת בקשות 2026`
        : `"${opp.title}" ${opp.funder || ''} apply grant application form 2026`;

      const results = await webSearch(query, { maxResults: 5, searchDepth: 'advanced' });
      if (!results.length) { skipped++; continue; }

      const snippets = results.map((r) => `URL: ${r.url}\n${r.title}\n${r.content}`).join('\n\n---\n\n');
      const applicationUrl = await extractApplicationUrl(opp.title, opp.funder, opp.url, snippets, isGov);

      if (!applicationUrl) { skipped++; continue; }

      const isAlive = await validateUrl(applicationUrl);
      if (!isAlive) { skipped++; continue; }

      await supabase.from('opportunities').update({ application_url: applicationUrl }).eq('id', opp.id);

      if (opp.funder) {
        await supabase.from('funder_intelligence').upsert({
          funder_name: opp.funder,
          application_url: applicationUrl,
          url_verified_at: new Date().toISOString(),
          url_source: urlSource,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'funder_name', ignoreDuplicates: false });
        fiCache.set(opp.funder, applicationUrl);
      }

      enriched++;
      await new Promise(r => setTimeout(r, 300));
    } catch {
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, processed: opps.length, enriched, skipped });
}
