/**
 * GET /api/debug/enrich-dryrun?source=shatil&batch=20
 *
 * Debug-only endpoint — always dryRun=true, never writes to DB.
 * No CRON_SECRET required. Protected by NODE_ENV check (disabled in production).
 *
 * For source=shatil: only processes urls containing /kol/
 * Skips non-opportunity shatil paths: /projects-category/, /consultation/, etc.
 * Auto-selects obvious direct links (Google Forms, PDF, etc.) without Gemini.
 *
 * Remove this file after use.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// ── Shatil: paths that are NOT קולות קוראים ──────────────────────────────────

const SHATIL_SKIP_PATHS = [
  '/projects-category/',
  '/consultation/',
  '/אודות/',
  '/about/',
  '/ארגז-הכלים/',
  '/newsletter/',
  '/40x40/',
  '/blog/',
  '/news/',
  '/category/',
  '/page/',
  '/tag/',
  '/author/',
  '/contact/',
  '/team/',
];

function isShatilOpportunity(url: string | null): boolean {
  if (!url) return false;
  // Must contain /kol/
  if (!/\/kol\//i.test(url)) return false;
  // Must not match skip paths
  const lower = url.toLowerCase();
  return !SHATIL_SKIP_PATHS.some(p => lower.includes(p.toLowerCase()));
}

// ── Link quality classification ───────────────────────────────────────────────

type LinkQuality =
  | 'direct_application'
  | 'official_pdf'
  | 'direct_call_page'
  | 'general_listing'
  | 'homepage'
  | 'broken'
  | 'aggregator_specific'
  | 'unknown';

const AGGREGATOR_HOSTS = [
  'shatil.org.il',
  'ezvonot.com',
  'pais.co.il',
  'panim.net',
  'panim.org',
  'kkl.org.il',
  'btl.gov.il',
  'meshulash.org.il',
  'kolzchut.org.il',
];

// URLs we never want to pick as application_url
const REJECT_PATTERNS = [
  /instagram\.com/i,
  /facebook\.com/i,
  /twitter\.com/i,
  /linkedin\.com/i,
  /youtube\.com/i,
  /whatsapp\./i,
  /tiktok\.com/i,
  // Shatil internal assets / stock images
  /shatil\.org\.il\/wp-content\//i,
  /shatil\.org\.il\/stock/i,
  // Accessibility / footer junk
  /#accessibility/i,
  /#footer/i,
  /#main/i,
  /\/accessibility\/?$/i,
  /\/sitemap\/?$/i,
  /\/privacy\/?$/i,
  /\/terms\/?$/i,
  // mailto / tel
  /^mailto:/i,
  /^tel:/i,
];

// Clear auto-select patterns — no Gemini needed
const AUTO_SELECT_PATTERNS = [
  /forms\.gle\//i,
  /docs\.google\.com\/forms/i,
  /forms\.(monday|typeform|jotform)\.com/i,
  /typeform\.com\//i,
  /jotform\.com\//i,
  /monday\.com\//i,
  /\.pdf([?#]|$)/i,
  /\/call-for-proposal/i,
  /\/call-for-project/i,
  /\/call_for_\d+/i,
  /\/award[s]?\//i,
  /\/(apply|application|submit|proposal|rfp)(\b|\/|\?)/i,
  /[?&](grantId|callId|applicationId|pid|gid)=[\w-]+/i,
  /\/p\/\d{6,}/i,
  /taktziv\.mof\.gov\.il/i,
  /pras\.most\.gov\.il/i,
  /\/he\/service\//i,
];

const GENERAL_NEGATIVE = [
  /^https?:\/\/[^/]+\/?$/,
  /^https?:\/\/[^/]+\/(he|en|il|about|contact|home)\/?$/i,
  /\/(grants?|funds?|scholarships?|support|calls?|programs?)\/?$/i,
  /\/(grants-and-scholarships|grants-page|funding-opportunities)\/?$/i,
  /\/category\//i,
  /\/blog\//i,
  /\/news\//i,
  /\/page\//i,
  /\/(about|team|staff|board|leadership|mission|vision|accessibility|sitemap|privacy|terms)\//i,
];

function cleanUrl(url: string): string {
  // Remove fbclid and utm tracking params, fix &amp;
  try {
    const u = new URL(url.replace(/&amp;/g, '&'));
    u.searchParams.delete('fbclid');
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    u.searchParams.delete('utm_content');
    u.searchParams.delete('utm_term');
    return u.toString();
  } catch {
    return url.replace(/&amp;/g, '&');
  }
}

function isRejected(url: string): boolean {
  return REJECT_PATTERNS.some(p => p.test(url));
}

function isAutoSelect(url: string): boolean {
  return AUTO_SELECT_PATTERNS.some(p => p.test(url));
}

function classifyLinkQuality(url: string): LinkQuality {
  if (!url) return 'unknown';
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 'broken'; }

  const path = parsed.pathname;

  if (path === '/' || path === '' || path.split('/').filter(Boolean).length === 0) return 'homepage';
  if (path.split('/').filter(Boolean).length === 1 && /^\/(he|en|il)\/?$/i.test(path)) return 'homepage';
  if (GENERAL_NEGATIVE.some(re => re.test(url))) return 'general_listing';
  if (/\.pdf([?#]|$)/i.test(url)) return 'official_pdf';
  if (AUTO_SELECT_PATTERNS.some(re => re.test(url))) return 'direct_application';
  if (AGGREGATOR_HOSTS.some(h => parsed.hostname.includes(h)) && path.split('/').filter(Boolean).length >= 2) return 'aggregator_specific';

  return 'unknown';
}

function isDirect(q: LinkQuality): boolean {
  return q === 'direct_application' || q === 'official_pdf' || q === 'direct_call_page';
}

function isUseless(q: LinkQuality): boolean {
  return q === 'general_listing' || q === 'homepage' || q === 'broken';
}

// ── Fetch page HTML and extract candidate links ───────────────────────────────

async function fetchCandidateLinks(
  pageUrl: string,
  title: string,
): Promise<{ href: string; text: string; quality: LinkQuality; score: number; auto: boolean }[]> {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(pageUrl, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return [];
    const html = await res.text();

    const linkRegex = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const seen = new Set<string>();
    const results: { href: string; text: string; quality: LinkQuality; score: number; auto: boolean }[] = [];
    let m;

    while ((m = linkRegex.exec(html)) !== null) {
      const rawHref = m[1].trim();
      const text = m[2].replace(/<[^>]+>/g, '').trim().slice(0, 200);

      if (!rawHref || /^(javascript|mailto|tel):/i.test(rawHref)) continue;

      let absolute: string;
      try { absolute = new URL(rawHref, pageUrl).toString(); } catch { continue; }

      const cleaned = cleanUrl(absolute);
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);

      // Skip rejected patterns
      if (isRejected(cleaned)) continue;

      // Skip same-domain links back to the aggregator
      try {
        const pageHost = new URL(pageUrl).hostname;
        const linkHost = new URL(cleaned).hostname;
        if (linkHost === pageHost) continue;
      } catch { continue; }

      const quality = classifyLinkQuality(cleaned);
      if (isUseless(quality)) continue;

      let score = 0;
      const auto = isAutoSelect(cleaned);

      if (auto) score += 100;
      else if (isDirect(quality)) score += 40;
      else if (quality === 'unknown') score += 5;

      // Text signals
      const lowerText = text.toLowerCase();
      if (/הגשה|הגש|apply|submit/i.test(lowerText)) score += 20;
      if (/טופס|form|בקשה/i.test(lowerText)) score += 15;
      if (/לחצו כאן|לחץ כאן|click here/i.test(lowerText)) score += 10;

      // URL signals
      if (/google\.com\/forms|typeform|monday|jotform|forms\.gle/i.test(cleaned)) score += 30;
      if (/\.pdf/i.test(cleaned)) score += 25;

      // Title word overlap
      const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const textWords = lowerText.split(/\s+/);
      const overlap = titleWords.filter(w => textWords.some(tw => tw.includes(w))).length;
      score += overlap * 8;

      if (score > 0) {
        results.push({ href: cleaned, text, quality, score, auto });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 8);
  } catch {
    return [];
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const reqUrl = new URL(req.url);

  const debugSecret = process.env.DEBUG_DRYRUN_SECRET;
  if (!debugSecret) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const providedSecret = reqUrl.searchParams.get('secret');
  if (!providedSecret || providedSecret !== debugSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const batchSize = Math.min(50, parseInt(reqUrl.searchParams.get('batch') || '20'));
  const filterSource = reqUrl.searchParams.get('source') || null;
  const isShatil = filterSource?.toLowerCase() === 'shatil';

  const supabase = createAdminClient();

  let query = supabase
    .from('opportunities')
    .select('id, title, funder, url, source, application_url, requirements, description')
    .eq('active', true)
    .order('scraped_at', { ascending: false })
    .limit(batchSize * 5);

  if (filterSource) {
    query = query.ilike('source', `%${filterSource}%`);
  }

  const { data: allOpps, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!allOpps?.length) return NextResponse.json({ ok: true, message: 'No opportunities found', processed: 0 });

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

  // Separate shatil non-kol rows for reporting
  const skippedNotKol: { id: string; title: string; url: string | null; reason: string }[] = [];
  const eligibleOpps: OppRow[] = [];

  for (const opp of allOpps as OppRow[]) {
    if (isShatil) {
      if (!isShatilOpportunity(opp.url)) {
        skippedNotKol.push({
          id: opp.id,
          title: opp.title,
          url: opp.url,
          reason: /\/kol\//i.test(opp.url || '') ? 'matches_skip_path' : 'not_kol_url',
        });
        continue;
      }
    }

    const appUrl = opp.application_url;
    const currentQuality = appUrl ? classifyLinkQuality(appUrl) : null;
    // Only enrich if: no application_url, or existing one is useless
    if (!appUrl || isUseless(currentQuality!)) {
      eligibleOpps.push(opp);
    }
  }

  const opps = eligibleOpps.slice(0, batchSize);

  if (opps.length === 0) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      processed: 0,
      skipped_not_kol: skippedNotKol.length,
      skipped_not_kol_list: skippedNotKol,
      message: isShatil
        ? 'No eligible /kol/ opportunities need enrichment'
        : 'All active opportunities already have direct application links',
    });
  }

  // ── Process each opp ────────────────────────────────────────────────────────

  const report = [];

  for (const opp of opps) {
    const rec: {
      id: string;
      title: string;
      funder: string | null;
      source: string | null;
      current_url: string | null;
      current_application_url: string | null;
      chosen_application_url: string | null;
      confidence: number;
      link_quality: LinkQuality;
      method: string;
      auto_selected: boolean;
      candidates: { href: string; text: string; quality: LinkQuality; score: number; auto: boolean }[];
      rejected_links: { href: string; reason: string }[];
      would_update: boolean;
      needs_direct_source: boolean;
      skip_reason?: string;
    } = {
      id: opp.id,
      title: opp.title,
      funder: opp.funder,
      source: opp.source,
      current_url: opp.url,
      current_application_url: opp.application_url,
      chosen_application_url: null,
      confidence: 0,
      link_quality: 'unknown',
      method: 'none',
      auto_selected: false,
      candidates: [],
      rejected_links: [],
      would_update: false,
      needs_direct_source: true,
    };

    try {
      // Only fetch if it's a specific aggregator page (has a slug)
      const urlQuality = opp.url ? classifyLinkQuality(opp.url) : 'unknown';
      const canFetch = opp.url && (urlQuality === 'aggregator_specific' || urlQuality === 'unknown');

      if (canFetch && opp.url) {
        const candidates = await fetchCandidateLinks(opp.url, opp.title);
        rec.candidates = candidates;

        // Step 1: auto-select obvious direct link (no Gemini needed)
        const autoCandidate = candidates.find(c => c.auto && !isRejected(c.href));
        if (autoCandidate) {
          rec.chosen_application_url = autoCandidate.href;
          rec.confidence = 90;
          rec.link_quality = classifyLinkQuality(autoCandidate.href);
          rec.method = 'auto_select';
          rec.auto_selected = true;
          rec.would_update = true;
          rec.needs_direct_source = false;
          rec.rejected_links = candidates
            .filter(c => c !== autoCandidate)
            .map(c => ({ href: c.href, reason: 'lower priority than auto-selected' }));
        } else if (candidates.length > 0) {
          // Step 2: best non-auto candidate (would go to Gemini in real run)
          const best = candidates[0];
          if (isDirect(best.quality) && best.score >= 40) {
            rec.chosen_application_url = best.href;
            rec.confidence = 70;
            rec.link_quality = best.quality;
            rec.method = 'best_candidate_direct';
            rec.would_update = true;
            rec.needs_direct_source = false;
          } else {
            rec.method = 'needs_gemini';
            rec.needs_direct_source = true;
          }
          rec.rejected_links = candidates
            .filter(c => c !== candidates[0])
            .map(c => ({ href: c.href, reason: `score=${c.score}, quality=${c.quality}` }));
        } else {
          rec.method = 'no_candidates_found';
          rec.needs_direct_source = true;
        }
      } else if (!canFetch && opp.url) {
        rec.skip_reason = `url_quality=${urlQuality} — not fetching`;
        rec.needs_direct_source = true;
      } else {
        rec.skip_reason = 'no_url';
        rec.needs_direct_source = true;
      }
    } catch (err) {
      rec.skip_reason = `error: ${String(err).slice(0, 120)}`;
      rec.needs_direct_source = true;
    }

    report.push(rec);

    // Rate limit between fetches
    await new Promise(r => setTimeout(r, 300));
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  return NextResponse.json({
    ok: true,
    dry_run: true,
    note: 'No DB writes. DryRun only.',
    source_filter: filterSource,
    shatil_kol_only: isShatil,
    processed: report.length,
    skipped_not_kol: skippedNotKol.length,
    would_update: report.filter(r => r.would_update).length,
    needs_direct_source: report.filter(r => r.needs_direct_source).length,
    auto_selected: report.filter(r => r.auto_selected).length,
    methods: {
      auto_select: report.filter(r => r.method === 'auto_select').length,
      best_candidate_direct: report.filter(r => r.method === 'best_candidate_direct').length,
      needs_gemini: report.filter(r => r.method === 'needs_gemini').length,
      no_candidates: report.filter(r => r.method === 'no_candidates_found').length,
      none: report.filter(r => r.method === 'none').length,
    },
    skipped_not_kol_list: skippedNotKol,
    report,
  }, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
