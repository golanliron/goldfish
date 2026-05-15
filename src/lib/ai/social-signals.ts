/**
 * social-signals.ts
 * Opportunity Hunter — scans LinkedIn, news, newsletters for hidden grant signals
 * Uses Tavily search + Claude to extract structured opportunities from social content
 */

import Anthropic from '@anthropic-ai/sdk';
import { webSearch, type SearchResult } from './web-search';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface Influencer {
  id: string;
  name: string;
  title: string | null;
  organization: string | null;
  org_type: string | null;
  keywords: string[] | null;
  topics: string[] | null;
  regions: string[] | null;
}

export interface HotOpportunity {
  source_type: 'linkedin' | 'twitter' | 'news' | 'newsletter' | 'website' | 'other';
  source_name: string;
  source_url: string;
  title: string;
  description: string;
  pain_point: string;
  strategic_insight: string;
  amount_hint: string;
  deadline_hint: string;
  raw_text: string;
  match_topics: string[]; // topics this opportunity relates to
}

// ────────────────────────────────────────────────
// SEARCH QUERIES
// ────────────────────────────────────────────────

/**
 * Build search queries for an influencer to find their recent posts/signals
 */
function buildInfluencerQueries(influencer: Influencer): string[] {
  const queries: string[] = [];
  const { name, organization, keywords, org_type } = influencer;

  // Query 1: LinkedIn activity (Google-indexed version)
  queries.push(`site:linkedin.com "${name}" post 2025 OR 2026 grant funding`);

  // Query 2: Hebrew/English news about this person + grants
  if (keywords && keywords.length > 0) {
    const kw = keywords.slice(0, 3).join(' OR ');
    queries.push(`${kw} "קול קורא" OR "מענק" OR "grant" OR "funding" 2025 2026`);
  }

  // Query 3: Organization + recent announcements
  if (organization) {
    queries.push(`"${organization}" מענק OR קול קורא OR "unrestricted funding" OR "emergency grant" OR "new initiative"`);
  }

  // For federation/international — English search
  if (org_type === 'federation' && name) {
    queries.push(`"${name}" OR "${organization || ''}" grant opportunity nonprofit 2025 2026`);
  }

  return queries;
}

/**
 * Build keyword-based broad signal queries (not tied to specific person)
 */
function buildSignalQueries(): string[] {
  return [
    // Hebrew social signals
    'מחפשים עמותה OR "קוראים לעמותות" OR "מזמינים הגשות" site:linkedin.com OR site:facebook.com',
    'מענק חירום OR "emergency funding" OR "rapid response grant" ישראל 2026',
    '"קול קורא חדש" OR "קרן חדשה" OR "תוכנית חדשה" עמותה נוער 2026',
    '"unrestricted funding" OR "general operating support" Israel nonprofit 2026',
    // Newsletter / sector news sources
    'shatil.org.il קול קורא OR מענק 2026',
    'guidestar.org.il OR molsa.gov.il OR jdc.org.il קול קורא חדש 2026',
    // English Jewish philanthropy signals
    'Jewish foundation "accepting applications" OR "open RFP" Israel youth 2026',
    'Jewish federation "new grant" OR "emergency grant" Israel programs 2026',
  ];
}

// ────────────────────────────────────────────────
// EXTRACTION
// ────────────────────────────────────────────────

/**
 * Use Claude Haiku to extract a structured HotOpportunity from raw search results
 * Returns null if content is not a real funding signal
 */
async function extractOpportunityFromResults(
  results: SearchResult[],
  sourceInfluencer?: Influencer
): Promise<HotOpportunity | null> {
  if (results.length === 0) return null;

  const rawText = results
    .map(r => `כותרת: ${r.title}\nתוכן: ${r.content}\nמקור: ${r.url}`)
    .join('\n\n---\n\n')
    .slice(0, 6000);

  const prompt = `אתה מנתח מידע מודיעיני עבור Goldfish — פלטפורמת גיוס משאבים לעמותות.

קראת תוצאות חיפוש מהאינטרנט. עליך לזהות אם יש בהן "אות מימון" — כלומר סיגנל שגורם מממן פתח או עומד לפתוח הזדמנות מימון, גם אם היא לא מפורסמת באתר רשמי.

תוצאות החיפוש:
${rawText}

${sourceInfluencer ? `הוחפש בהקשר של: ${sourceInfluencer.name}, ${sourceInfluencer.organization}` : ''}

אם מצאת אות מימון אמיתי, ענה ב-JSON מדויק עם השדות הבאים:
{
  "is_opportunity": true,
  "source_type": "linkedin|twitter|news|newsletter|website|other",
  "source_name": "שם האדם/גוף שפרסם",
  "source_url": "URL הישיר לפוסט/מאמר",
  "title": "כותרת קצרה (עברית)",
  "description": "תיאור 2-3 משפטים של ההזדמנות",
  "pain_point": "מה הבעיה/צורך שהגוף המממן מנסה לפתור כרגע",
  "amount_hint": "סכום משוערך אם הוזכר, אחרת רק הערכה גסה",
  "deadline_hint": "תאריך/חלון זמן משוערך אם הוזכר",
  "match_topics": ["תחום1","תחום2"],
  "strategic_insight": "משפט אחד: מדוע ארגון שעובד עם נוער/תעסוקה/קהילה צריך לפנות עכשיו"
}

אם אין אות מימון אמיתי, ענה: {"is_opportunity": false}
ענה ב-JSON בלבד, ללא הסברים נוספים.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    // Strip markdown code block if present
    const clean = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(clean);

    if (!parsed.is_opportunity) return null;

    return {
      source_type: parsed.source_type || 'other',
      source_name: parsed.source_name || '',
      source_url: parsed.source_url || (results[0]?.url ?? ''),
      title: parsed.title || '',
      description: parsed.description || '',
      pain_point: parsed.pain_point || '',
      strategic_insight: parsed.strategic_insight || '',
      amount_hint: parsed.amount_hint || '',
      deadline_hint: parsed.deadline_hint || '',
      raw_text: rawText.slice(0, 3000),
      match_topics: parsed.match_topics || [],
    };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────
// MATCHING
// ────────────────────────────────────────────────

/**
 * Score an opportunity against an org profile
 * Returns 0–100
 */
export function scoreOppForOrg(
  opp: HotOpportunity,
  orgTopics: string[],
  orgRegions: string[]
): number {
  if (!orgTopics.length) return 40; // unknown org — show everything at medium score

  const oppTopics = opp.match_topics.map(t => t.toLowerCase());
  const orgT = orgTopics.map(t => t.toLowerCase());

  const topicOverlap = oppTopics.filter(t => orgT.some(ot => ot.includes(t) || t.includes(ot))).length;
  const topicScore = Math.min(topicOverlap * 25, 70);

  // Bonus for IL region match
  const regionBonus = orgRegions.includes('IL') ? 20 : 0;

  // Bonus if there's a deadline hint (more urgent = more actionable)
  const urgencyBonus = opp.deadline_hint ? 10 : 0;

  return Math.min(topicScore + regionBonus + urgencyBonus, 100);
}

// ────────────────────────────────────────────────
// MAIN SCANNER
// ────────────────────────────────────────────────

export interface ScanResult {
  opportunities: HotOpportunity[];
  scanned_queries: number;
  influencers_checked: number;
}

/**
 * Full scan: check watchlist influencers + broad signal queries
 * Returns discovered hot opportunities (deduplication handled by caller)
 */
export async function runSocialScan(
  influencers: Influencer[],
  maxQueriesPerInfluencer = 2
): Promise<ScanResult> {
  const discovered: HotOpportunity[] = [];
  let scannedQueries = 0;

  // 1. Influencer watchlist scan
  for (const influencer of influencers) {
    const queries = buildInfluencerQueries(influencer).slice(0, maxQueriesPerInfluencer);

    for (const query of queries) {
      try {
        const results = await webSearch(query, {
          maxResults: 5,
          searchDepth: 'basic',
          topic: 'news',
        });
        scannedQueries++;

        if (results.length === 0) continue;

        const opp = await extractOpportunityFromResults(results, influencer);
        if (opp) discovered.push(opp);
      } catch {
        // Skip failed queries silently
      }
    }
  }

  // 2. Broad signal scan (not tied to specific influencer)
  const signalQueries = buildSignalQueries();
  for (const query of signalQueries) {
    try {
      const results = await webSearch(query, { maxResults: 5, topic: 'news' });
      scannedQueries++;

      if (results.length === 0) continue;

      const opp = await extractOpportunityFromResults(results);
      if (opp) discovered.push(opp);
    } catch {
      // Skip
    }
  }

  // Deduplicate by source_url
  const seen = new Set<string>();
  const unique = discovered.filter(o => {
    if (!o.source_url || seen.has(o.source_url)) return false;
    seen.add(o.source_url);
    return true;
  });

  return {
    opportunities: unique,
    scanned_queries: scannedQueries,
    influencers_checked: influencers.length,
  };
}

/**
 * Extract a hot opportunity from an email body (for ingest@goldfish.ai)
 */
export async function extractFromEmail(
  subject: string,
  body: string
): Promise<HotOpportunity | null> {
  const combined: SearchResult[] = [{
    title: subject,
    url: '',
    content: body.slice(0, 4000),
    score: 1,
  }];
  return extractOpportunityFromResults(combined);
}
