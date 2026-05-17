/**
 * GET /api/cron/enrich-direct-links?batch=20[&dryRun=true][&source=shatil]
 *
 * Direct-Link Enrichment for grant opportunities.
 *
 * For every active opportunity where application_url is null OR link_quality is not "direct":
 *  1. If existing url is an aggregator page (Shatil / ezvonot / pais_culture / kkl):
 *     → Fetch the aggregator page HTML
 *     → Extract external links that look like direct application pages
 *     → Choose best candidate, validate it's live
 *  2. If existing application_url exists but is "general" or "homepage":
 *     → Mark needs_direct_source=true, do NOT overwrite with something worse
 *  3. If aggregator extraction yields nothing → fall back to web search
 *  4. If still nothing → mark needs_direct_source=true, set link_quality=aggregator_only
 *
 * DryRun mode: returns full report without writing to DB.
 * Priority sources: shatil, ezvonot, pais_culture, kkl
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { geminiCall } from '@/lib/ai/gemini';
import { webSearch } from '@/lib/ai/web-search';

export const maxDuration = 300;

// ── Aggregator detection ──────────────────────────────────────────────────────

const AGGREGATOR_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'shatil',        pattern: /shatil\.org\.il/i },
  { name: 'ezvonot',       pattern: /ezvonot\.com/i },
  { name: 'pais_culture',  pattern: /pais\.co\.il|panim\.net|panim\.org/i },
  { name: 'kkl',           pattern: /kkl\.org\.il/i },
  { name: 'btl',           pattern: /btl\.gov\.il/i },
  { name: 'gov_portal',    pattern: /gov\.il\/he\/(departments|topics|pages)/i },
  { name: 'meshulash',     pattern: /meshulash\.org\.il/i },
  { name: 'kolzchut',      pattern: /kolzchut\.org\.il/i },
  { name: 'yad_hanadiv',   pattern: /yadhanadiv\.org\.il/i },
];

function detectAggregator(url: string | null): string | null {
  if (!url) return null;
  for (const { name, pattern } of AGGREGATOR_PATTERNS) {
    if (pattern.test(url)) return name;
  }
  return null;
}

// ── Link quality classification ───────────────────────────────────────────────

type LinkQuality = 'direct_application' | 'official_pdf' | 'direct_call_page' |
  'general_listing' | 'homepage' | 'broken' | 'aggregator_specific' | 'unknown';

const DIRECT_POSITIVE = [
  /\.pdf([?#]|$)/i,
  /forms\.(monday|typeform|jotform|google)\./i,
  /docs\.google\.com\/forms/i,
  /\/(apply|application|grant-application|submit-application|request|proposal|rfp|call-for-proposals?)(\b|\/|\?)/i,
  /[?&](grant|call|program|id|pid|gid|ref|callId|grantId)=[\w-]+/i,
  /\/call_for_\d+/i,
  /taktziv\.mof\.gov\.il|pras\.most\.gov\.il/i,
  /\/he\/service\//i,
  /\/p\/\d{6,}/i, // mr.gov.il product IDs
  /\/(grant|call|program|competition|contest|scholarship)[-_]\d+/i,
];

const GENERAL_NEGATIVE = [
  /^https?:\/\/[^/]+\/?$/,                                           // homepage only
  /^https?:\/\/[^/]+\/(he|en|il|about|contact|home)\/?$/i,         // lang root
  /\/(grants?|funds?|scholarships?|support|calls?|programs?)\/?$/i, // listing pages
  /\/(grants-and-scholarships|grants-page|funding-opportunities)\/?$/i,
  /\/category\//i,
  /\/blog\//i,
  /\/news\//i,
  /\/page\//i,
  /\/(about|team|staff|board|leadership|mission|vision)\//i,
];

function classifyLinkQuality(url: string): LinkQuality {
  if (!url) return 'unknown';
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 'broken'; }

  const full = url;
  const path = parsed.pathname;

  // Homepage check
  if (path === '/' || path === '' || (path.split('/').filter(Boolean).length === 0)) return 'homepage';
  if (path.split('/').filter(Boolean).length === 1 && path.match(/^\/(he|en|il)\/?$/i)) return 'homepage';

  // General negative patterns
  if (GENERAL_NEGATIVE.some(re => re.test(full))) return 'general_listing';

  // Direct positive patterns
  if (/\.pdf([?#]|$)/i.test(full)) return 'official_pdf';
  if (DIRECT_POSITIVE.some(re => re.test(full))) return 'direct_application';

  // Aggregator-specific page (has slug/path that is specific but not verified direct)
  if (detectAggregator(url) && path.split('/').filter(Boolean).length >= 2) return 'aggregator_specific';

  return 'unknown';
}

function isDirect(q: LinkQuality): boolean {
  return q === 'direct_application' || q === 'official_pdf' || q === 'direct_call_page';
}

function isUseless(q: LinkQuality): boolean {
  return q === 'general_listing' || q === 'homepage' || q === 'broken';
}

// ── Fetch aggregator page and extract candidate links ─────────────────────────

async function fetchAggregatorLinks(pageUrl: string): Promise<{ href: string; text: string }[]> {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(pageUrl, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Extract all <a href> links with their text
    const linkRegex = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const links: { href: string; text: string }[] = [];
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      const href = m[1].trim();
      const text = m[2].replace(/<[^>]+>/g, '').trim().slice(0, 200);
      if (!href || href.startsWith('javascript') || href.startsWith('mailto')) continue;

      // Resolve relative URLs
      let absolute: string;
      try {
        absolute = new URL(href, pageUrl).toString();
      } catch {
        continue;
      }
      links.push({ href: absolute, text });
    }
    return links;
  } catch {
    return [];
  }
}

// Filter extracted links to keep only candidates that might be direct application links
function filterCandidateLinks(
  links: { href: string; text: string }[],
  aggregatorHost: string,
  opportunityTitle: string
): { href: string; text: string; quality: LinkQuality }[] {
  const lowerTitle = opportunityTitle.toLowerCase();
  const candidates: { href: string; text: string; quality: LinkQuality; score: number }[] = [];

  for (const { href, text } of links) {
    let parsed: URL;
    try { parsed = new URL(href); } catch { continue; }

    // Skip same aggregator domain (internal links)
    if (parsed.hostname === new URL(aggregatorHost).hostname) continue;

    const quality = classifyLinkQuality(href);

    // Skip homepage/general/aggregator on target site
    if (isUseless(quality)) continue;

    let score = 0;

    // Boost direct application links
    if (isDirect(quality)) score += 40;
    else if (quality === 'aggregator_specific' || quality === 'unknown') score += 5;

    // Boost if link text resembles the opportunity
    const lowerText = text.toLowerCase();
    if (lowerText.includes('הגשה') || lowerText.includes('הגש') || lowerText.includes('apply') || lowerText.includes('submit')) score += 20;
    if (lowerText.includes('טופס') || lowerText.includes('form') || lowerText.includes('בקשה')) score += 15;
    if (lowerText.includes('לחצו כאן') || lowerText.includes('click here') || lowerText.includes('לחץ')) score += 10;

    // Boost if URL contains known form/apply patterns
    if (/google\.com\/forms|typeform|monday\.com|jotform/i.test(href)) score += 30;
    if (/\.pdf/i.test(href)) score += 25;

    // Title word overlap with link text
    const titleWords = lowerTitle.split(/\s+/).filter(w => w.length > 3);
    const textWords = lowerText.split(/\s+/);
    const overlap = titleWords.filter(w => textWords.some(tw => tw.includes(w))).length;
    score += overlap * 8;

    if (score > 0) {
      candidates.push({ href, text, quality, score });
    }
  }

  // Sort by score descending, return top 5
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ href, text, quality }) => ({ href, text, quality }));
}

// ── Validate URL is live ──────────────────────────────────────────────────────

async function validateUrl(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    });
    return res.ok || res.status === 405 || res.status === 403;
  } catch {
    return false;
  }
}

// ── AI: pick best candidate from list ────────────────────────────────────────

async function aiPickBestLink(
  title: string,
  funder: string | null,
  candidates: { href: string; text: string; quality: LinkQuality }[],
  aggregatorUrl: string
): Promise<{ chosen: string | null; rejected: { href: string; reason: string }[]; confidence: number }> {
  if (candidates.length === 0) return { chosen: null, rejected: [], confidence: 0 };

  const listStr = candidates
    .map((c, i) => `[${i + 1}] href: ${c.href}\n    text: "${c.text}"\n    quality: ${c.quality}`)
    .join('\n\n');

  const prompt = `אתה מומחה גיוס משאבים. מהרשימה הבאה של לינקים שחולצו מדף aggregator, בחר את הלינק שמוביל ישירות לדף הגשת בקשה לקול הקורא.

קול קורא: "${title}"
גוף מממן: "${funder || 'לא ידוע'}"
מקור aggregator: ${aggregatorUrl}

לינקים שחולצו:
${listStr}

כללי בחירה:
- עדיפות ראשונה: Google Form / Typeform / Monday / JotForm / PDF רשמי
- עדיפות שנייה: דף עם slug ספציפי של הקול הקורא (שם+מספר)
- עדיפות שלישית: מערכת הגשה עם ID ספציפי
- פסול לחלוטין: דף בית, עמוד כללי של גוף, עמוד /grants כללי, /apply ללא ID
- אם אין לינק מתאים — החזר chosen: null

ענה אך ורק ב-JSON תקני:
{
  "chosen": "https://..." או null,
  "confidence": 0-100,
  "reason": "הסבר קצר בעברית",
  "rejected": [
    { "href": "...", "reason": "סיבה לפסילה" }
  ]
}`;

  try {
    const raw = await geminiCall(prompt, 600, 0.1);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { chosen: null, rejected: [], confidence: 0 };
    const parsed = JSON.parse(m[0]);
    return {
      chosen: parsed.chosen && typeof parsed.chosen === 'string' && parsed.chosen.startsWith('http')
        ? parsed.chosen : null,
      rejected: Array.isArray(parsed.rejected) ? parsed.rejected : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 50,
    };
  } catch {
    // Fallback: return first direct link
    const first = candidates.find(c => isDirect(c.quality));
    return { chosen: first?.href ?? null, rejected: [], confidence: first ? 60 : 0 };
  }
}

// ── Web search fallback ───────────────────────────────────────────────────────

async function webSearchFallback(title: string, funder: string | null): Promise<string | null> {
  const query = `"${title}" ${funder || ''} טופס הגשה לינק ישיר site:google.com OR site:typeform.com OR filetype:pdf 2025 2026`;
  try {
    const results = await webSearch(query, { maxResults: 4, searchDepth: 'advanced' });
    if (!results.length) return null;

    const prompt = `מתוצאות החיפוש הבאות על קול הקורא "${title}", חלץ לינק ישיר לדף הגשת הבקשה.

${results.map(r => `URL: ${r.url}\n${r.title}\n${r.content?.slice(0, 300)}`).join('\n\n---\n\n')}

ענה רק ב-JSON: { "application_url": "https://..." } או { "application_url": null }`;

    const raw = await geminiCall(prompt, 200, 0.1);
    const m = raw.match(/\{[\s\S]*?\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const url = parsed.application_url;
    if (!url || !url.startsWith('http')) return null;
    if (isUseless(classifyLinkQuality(url))) return null;
    return url;
  } catch {
    return null;
  }
}

// ── Report record type ────────────────────────────────────────────────────────

interface EnrichReport {
  id: string;
  title: string;
  funder: string | null;
  source: string | null;
  current_url: string | null;
  current_application_url: string | null;
  aggregator: string | null;
  extracted_candidates: { href: string; text: string; quality: LinkQuality }[];
  chosen_application_url: string | null;
  rejected_links: { href: string; reason: string }[];
  confidence: number;
  method: 'direct_existing' | 'aggregator_extraction' | 'web_search_fallback' | 'none';
  link_quality: LinkQuality;
  needs_direct_source: boolean;
  would_update: boolean;
  skip_reason?: string;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = (req.headers as Headers).get?.('authorization') ||
      (req as unknown as { headers: Record<string, string> }).headers['authorization'];
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const reqUrl = new URL(req.url);
  const batchSize = Math.min(50, parseInt(reqUrl.searchParams.get('batch') || '20'));
  const dryRun = reqUrl.searchParams.get('dryRun') !== 'false'; // default TRUE for safety
  const filterSource = reqUrl.searchParams.get('source') || null; // e.g. shatil, ezvonot

  const supabase = createAdminClient();

  // ── Fetch opportunities to process ─────────────────────────────────────────
  // Target: active=true AND (application_url is null OR link_quality != 'direct')
  // Priority: shatil, ezvonot, pais_culture, kkl sources first
  let query = supabase
    .from('opportunities')
    .select('id, title, funder, url, source, application_url, requirements, description')
    .eq('active', true)
    .order('scraped_at', { ascending: false })
    .limit(batchSize * 3); // fetch more, filter in memory

  if (filterSource) {
    query = query.ilike('source', `%${filterSource}%`);
  }

  const { data: allOpps, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!allOpps || allOpps.length === 0) {
    return NextResponse.json({ ok: true, message: 'No opportunities found', processed: 0, dry_run: dryRun });
  }

  // Filter to only those needing enrichment
  type OppRow = {
    id: string;
    title: string;
    funder: string | null;
    url: string | null;
    source: string | null;
    application_url: string | null;
    requirements: Record<string, unknown> | null;
    description: string | null;
  };

  const PRIORITY_SOURCES = ['shatil', 'ezvonot', 'pais', 'kkl', 'meshulash'];

  const opps: OppRow[] = allOpps
    .filter((o: OppRow) => {
      const appUrl = o.application_url;
      const currentQuality = appUrl ? classifyLinkQuality(appUrl) : null;
      // Needs enrichment if: no application_url, or existing one is useless
      return !appUrl || isUseless(currentQuality!);
    })
    .sort((a: OppRow, b: OppRow) => {
      // Priority sources first
      const aP = PRIORITY_SOURCES.some(s => (a.source || '').toLowerCase().includes(s)) ? 0 : 1;
      const bP = PRIORITY_SOURCES.some(s => (b.source || '').toLowerCase().includes(s)) ? 0 : 1;
      return aP - bP;
    })
    .slice(0, batchSize);

  if (opps.length === 0) {
    return NextResponse.json({
      ok: true,
      message: 'All active opportunities already have direct application links',
      processed: 0,
      dry_run: dryRun,
    });
  }

  const report: EnrichReport[] = [];
  let enriched = 0;

  for (const opp of opps) {
    const rec: EnrichReport = {
      id: opp.id,
      title: opp.title,
      funder: opp.funder,
      source: opp.source,
      current_url: opp.url,
      current_application_url: opp.application_url,
      aggregator: null,
      extracted_candidates: [],
      chosen_application_url: null,
      rejected_links: [],
      confidence: 0,
      method: 'none',
      link_quality: 'unknown',
      needs_direct_source: false,
      would_update: false,
    };

    try {
      // ── Step 0: check if existing application_url is already useless ─────────
      if (opp.application_url) {
        const existingQ = classifyLinkQuality(opp.application_url);
        if (isDirect(existingQ)) {
          // Already good — should not have been included, skip
          rec.link_quality = existingQ;
          rec.skip_reason = 'application_url already direct';
          report.push(rec);
          continue;
        }
        // It's general/homepage/broken — mark needs_direct_source
        rec.needs_direct_source = true;
      }

      // ── Step 1: detect aggregator and extract links from the page ────────────
      const aggregatorName = detectAggregator(opp.url);
      rec.aggregator = aggregatorName;

      let chosen: string | null = null;
      let confidence = 0;
      let rejected: { href: string; reason: string }[] = [];
      let method: EnrichReport['method'] = 'none';

      if (aggregatorName && opp.url) {
        const urlQuality = classifyLinkQuality(opp.url);

        // Only fetch if it's a specific aggregator page (not just homepage)
        if (urlQuality === 'aggregator_specific' || urlQuality === 'unknown') {
          const allLinks = await fetchAggregatorLinks(opp.url);
          const candidates = filterCandidateLinks(allLinks, opp.url, opp.title);
          rec.extracted_candidates = candidates;

          if (candidates.length > 0) {
            const picked = await aiPickBestLink(opp.title, opp.funder, candidates, opp.url);
            chosen = picked.chosen;
            confidence = picked.confidence;
            rejected = picked.rejected;
            method = 'aggregator_extraction';
          }
        }
      }

      // ── Step 2: web search fallback ──────────────────────────────────────────
      if (!chosen) {
        const webUrl = await webSearchFallback(opp.title, opp.funder);
        if (webUrl) {
          chosen = webUrl;
          confidence = 55;
          method = 'web_search_fallback';
        }
      }

      // ── Step 3: validate the chosen URL ─────────────────────────────────────
      if (chosen) {
        const alive = await validateUrl(chosen);
        if (!alive) {
          rejected.push({ href: chosen, reason: 'HEAD validation failed — URL not reachable' });
          chosen = null;
          confidence = 0;
          method = 'none';
        }
      }

      // ── Step 4: classify final link quality ──────────────────────────────────
      const finalQuality = chosen ? classifyLinkQuality(chosen) : 'unknown';

      rec.chosen_application_url = chosen;
      rec.rejected_links = rejected;
      rec.confidence = confidence;
      rec.method = method;
      rec.link_quality = chosen ? finalQuality : 'unknown';
      rec.needs_direct_source = !chosen || !isDirect(finalQuality);
      rec.would_update = !!chosen && confidence >= 50;

      // ── Step 5: write to DB if not dryRun ────────────────────────────────────
      if (!dryRun && rec.would_update && chosen) {
        const requirements = (opp.requirements as Record<string, unknown>) || {};
        await supabase
          .from('opportunities')
          .update({
            application_url: chosen,
            requirements: {
              ...requirements,
              needs_direct_source: rec.needs_direct_source,
              link_quality: finalQuality,
              link_enriched_at: new Date().toISOString(),
              link_method: method,
            },
          })
          .eq('id', opp.id);
        enriched++;
      } else if (!dryRun && !chosen) {
        // Mark as needing manual review
        const requirements = (opp.requirements as Record<string, unknown>) || {};
        await supabase
          .from('opportunities')
          .update({
            requirements: {
              ...requirements,
              needs_direct_source: true,
              link_quality: aggregatorName ? 'aggregator_only' : 'unknown',
              link_enriched_at: new Date().toISOString(),
            },
          })
          .eq('id', opp.id);
      }
    } catch (err) {
      rec.skip_reason = `error: ${String(err).slice(0, 100)}`;
      rec.needs_direct_source = true;
    }

    report.push(rec);

    // Rate limit
    await new Promise(r => setTimeout(r, 400));
  }

  const would_update_count = report.filter(r => r.would_update).length;
  const needs_manual = report.filter(r => r.needs_direct_source).length;
  const aggregator_only = report.filter(r => r.aggregator && !r.chosen_application_url).length;

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    processed: opps.length,
    enriched: dryRun ? 0 : enriched,
    would_enrich: would_update_count,
    needs_manual_review: needs_manual,
    aggregator_only,
    quality_rate: opps.length > 0 ? Math.round((would_update_count / opps.length) * 100) : 0,
    methods: {
      aggregator_extraction: report.filter(r => r.method === 'aggregator_extraction').length,
      web_search_fallback: report.filter(r => r.method === 'web_search_fallback').length,
      none: report.filter(r => r.method === 'none').length,
    },
    report,
  });
}
