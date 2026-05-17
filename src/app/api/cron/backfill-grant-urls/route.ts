/**
 * GET /api/cron/backfill-grant-urls?batch=15[&dryRun=true]
 *
 * For every active opportunity without application_url:
 * 1. Detect if the source is gov.il (Merkava/portal) — handle deep scan
 * 2. Search the web for the direct application form URL
 * 3. Validate the URL is live (HEAD request)
 * 4. Save to opportunities.application_url + funder_intelligence.application_url (cross-org reuse)
 *
 * dryRun=true  — returns proposed changes without writing to DB (safe preview mode)
 * Authorization: Bearer <CRON_SECRET> required if CRON_SECRET env var is set
 *
 * Multi-tenant: Links are stored globally — all orgs benefit from one discovery.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { webSearch } from '@/lib/ai/web-search';
import { geminiCall } from '@/lib/ai/gemini';

export const maxDuration = 300;

// URL patterns that indicate a "general" funder page — never promote to application_url via fast-path
const GENERAL_URL_PATTERNS = [
  /^https?:\/\/[^/]+\/?$/,                                              // homepage only
  /\/(grants?|funds?|scholarships?|apply\/?$|support|calls?\/?$)\/?$/i, // listing pages
  /\/(grants-and-scholarships|grants-page)\/?$/i,
  /gov\.il\/(he|en)\/(departments|pages\/support-tests)\/?/i,
];

function isGeneralUrl(url: string): boolean {
  return GENERAL_URL_PATTERNS.some(re => re.test(url));
}

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

// Patterns that indicate a URL is already a direct application link
const DIRECT_URL_PATTERNS = [
  /\.pdf([?#]|$)/i,                                                          // PDF document
  /BlobFolder|rfp\//i,                                                       // gov.il blob/rfp
  /forms\.(monday|typeform|jotform|google)\./i,                              // form platforms
  /\/(form|apply|application|grant|call|rfp|submit|request|proposal|project)(\b|\/)/i,
  /[?&](grant|call|program|id|pid|gid|ref)=/i,
  /call_for_\d+/i,                                                           // kkl.org.il style
  /\/he\/service\//i,                                                        // gov.il service pages
  /\/he\/pages\/molsa/i,                                                     // welfare ministry
  /taktziv\.mof\.gov\.il|pras\.most\.gov\.il/i,                             // budget/prize portals
];

function isDirectUrl(url: string): boolean {
  if (!url) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }

  const path = parsed.pathname;
  const pathSegments = path.split('/').filter(Boolean);

  // ── Reject homepages / root domains first ─────────────────────────────────
  if (pathSegments.length === 0) return false; // https://call.gov.il/
  if (pathSegments.length === 1 && pathSegments[0].length <= 2) return false; // /he /en

  // ── Reject known general gov.il page patterns ─────────────────────────────
  // /he/departments/... landing pages, /he/pages/... (generic info), /he/topics/...
  if (/\/he\/(departments|topics|pages)\//i.test(path) && !(/\/he\/pages\/molsa/i.test(path))) return false;
  // govil-landing-page suffix = always a listing/landing
  if (path.endsWith('govil-landing-page')) return false;

  // ── Now check positive direct patterns ────────────────────────────────────
  if (DIRECT_URL_PATTERNS.some(re => re.test(url))) return true;
  // Deep path with numeric ID (e.g. mr.gov.il/ilgstorefront/he/p/4000609035)
  if (pathSegments.length >= 4 && /\d{4,}/.test(path)) return true;

  return false;
}

interface EnrichmentRecord {
  id: string;
  title: string;
  funder: string | null;
  old_url: string | null;
  existing_link_quality: 'direct' | 'general' | 'unknown';
  proposed_application_url: string | null;
  confidence: 'high' | 'medium' | 'low' | 'skipped';
  reason: string;
  would_update: boolean;
}

export async function GET(req: Request) {
  // ── Auth guard ──────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers instanceof Headers
      ? req.headers.get('authorization')
      : (req as unknown as { headers: Record<string, string> }).headers['authorization'];
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const reqUrl = new URL(req.url);
  const batchSize = Math.min(30, parseInt(reqUrl.searchParams.get('batch') || '15'));
  const dryRun = reqUrl.searchParams.get('dryRun') === 'true';

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
    return NextResponse.json({ ok: true, message: 'No opportunities to enrich', processed: 0, dry_run: dryRun });
  }

  let enriched = 0;
  let skipped = 0;
  const report: EnrichmentRecord[] = [];

  // Pre-load known application URLs from funder_intelligence
  // Only reuse if the stored URL is NOT a general listing page
  const funderNames = [...new Set(opps.map((o: Record<string, string | null>) => o.funder).filter(Boolean))] as string[];
  const fiCache = new Map<string, string>();
  if (funderNames.length > 0) {
    const { data: fiRows } = await supabase
      .from('funder_intelligence')
      .select('funder_name, application_url')
      .in('funder_name', funderNames)
      .not('application_url', 'is', null);
    for (const fi of (fiRows || [])) {
      // Only cache if the URL is specific (not a general page)
      if (fi.application_url && !isGeneralUrl(fi.application_url)) {
        fiCache.set(fi.funder_name, fi.application_url);
      }
    }
  }

  for (const opp of opps) {
    try {
      const existingLinkQuality: 'direct' | 'general' | 'unknown' = (() => {
        if (!opp.url) return 'unknown';
        try {
          if (isDirectUrl(opp.url)) return 'direct';
          if (isGeneralUrl(opp.url)) return 'general';
          return 'unknown';
        } catch { return 'unknown'; }
      })();

      // ── Step 0: existing URL is already a direct link — normalise it ──────────
      if (existingLinkQuality === 'direct') {
        const rec: EnrichmentRecord = {
          id: opp.id,
          title: opp.title,
          funder: opp.funder,
          old_url: opp.url,
          existing_link_quality: 'direct',
          proposed_application_url: opp.url,
          confidence: 'high',
          reason: 'direct_url_already_exists — ה-url הקיים כבר נראה כמו לינק ישיר, מנרמל ל-application_url',
          would_update: true,
        };
        report.push(rec);
        if (!dryRun) {
          await supabase.from('opportunities').update({ application_url: opp.url }).eq('id', opp.id);
          enriched++;
        }
        continue;
      }

      // ── Step 1: reuse known specific URL from funder_intelligence ─────────────
      if (opp.funder && fiCache.has(opp.funder)) {
        const cachedUrl = fiCache.get(opp.funder)!;
        const rec: EnrichmentRecord = {
          id: opp.id,
          title: opp.title,
          funder: opp.funder,
          old_url: opp.url,
          existing_link_quality: existingLinkQuality,
          proposed_application_url: cachedUrl,
          confidence: 'medium',
          reason: 'נלקח מ-funder_intelligence (כבר אומת לקול קורא אחר של אותו גוף)',
          would_update: true,
        };
        report.push(rec);
        if (!dryRun) {
          await supabase.from('opportunities').update({ application_url: cachedUrl }).eq('id', opp.id);
          enriched++;
        }
        continue;
      }

      // ── Step 2: web search ────────────────────────────────────────────────────
      const isGov = isGovSource(opp.url, opp.source);
      const urlSource = classifyUrlSource(opp.url, opp.source);

      const query = isGov
        ? `"${opp.title}" ${opp.funder || ''} פורטל הגשה מערכת בקשות 2026`
        : `"${opp.title}" ${opp.funder || ''} apply grant application form 2026`;

      const results = await webSearch(query, { maxResults: 5, searchDepth: 'advanced' });
      if (!results.length) {
        report.push({ id: opp.id, title: opp.title, funder: opp.funder, old_url: opp.url, existing_link_quality: existingLinkQuality, proposed_application_url: null, confidence: 'skipped', reason: `search_no_results — existing_url_${existingLinkQuality}`, would_update: false });
        skipped++;
        continue;
      }

      const snippets = results.map((r) => `URL: ${r.url}\n${r.title}\n${r.content}`).join('\n\n---\n\n');
      const applicationUrl = await extractApplicationUrl(opp.title, opp.funder, opp.url, snippets, isGov);

      if (!applicationUrl) {
        report.push({ id: opp.id, title: opp.title, funder: opp.funder, old_url: opp.url, existing_link_quality: existingLinkQuality, proposed_application_url: null, confidence: 'skipped', reason: 'needs_manual_review — AI לא זיהה לינק ישיר ברור', would_update: false });
        skipped++;
        continue;
      }

      // Reject if proposed URL is still a general page
      if (isGeneralUrl(applicationUrl)) {
        report.push({ id: opp.id, title: opp.title, funder: opp.funder, old_url: opp.url, existing_link_quality: existingLinkQuality, proposed_application_url: applicationUrl, confidence: 'low', reason: 'existing_url_general — הלינק המוצע הוא עמוד כללי, נדחה', would_update: false });
        skipped++;
        continue;
      }

      const isAlive = await validateUrl(applicationUrl);
      if (!isAlive) {
        report.push({ id: opp.id, title: opp.title, funder: opp.funder, old_url: opp.url, existing_link_quality: existingLinkQuality, proposed_application_url: applicationUrl, confidence: 'low', reason: 'הלינק לא פעיל (HEAD בדיקה נכשלה)', would_update: false });
        skipped++;
        continue;
      }

      const rec: EnrichmentRecord = {
        id: opp.id,
        title: opp.title,
        funder: opp.funder,
        old_url: opp.url,
        existing_link_quality: existingLinkQuality,
        proposed_application_url: applicationUrl,
        confidence: 'high',
        reason: 'נמצא מחיפוש ואומת כפעיל',
        would_update: true,
      };
      report.push(rec);

      if (!dryRun) {
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
      }

      await new Promise(r => setTimeout(r, 300));
    } catch {
      report.push({ id: opp.id, title: opp.title, funder: opp.funder, old_url: opp.url, existing_link_quality: 'unknown', proposed_application_url: null, confidence: 'skipped', reason: 'שגיאה בעיבוד', would_update: false });
      skipped++;
    }
  }

  const wouldUpdate = report.filter(r => r.would_update).length;

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    processed: opps.length,
    enriched: dryRun ? 0 : enriched,
    would_enrich: wouldUpdate,
    skipped: dryRun ? opps.length - wouldUpdate : skipped,
    quality_rate: opps.length > 0 ? Math.round((wouldUpdate / opps.length) * 100) : 0,
    report,
  });
}
