// Goldfish — Centralized Match Scoring Service
// Single source of truth for all relevance scoring across:
//   - Opportunities tab (scan/route.ts + opportunities/route.ts)
//   - Companies / Business tab (companies/route.ts)
//   - Federations tab (via companies/route.ts, type=fund)
//
// Two scoring modes:
//   1. scoreOpportunityAI  — Claude Haiku rates a batch of opportunities (1-10)
//   2. scoreCompanyDNA     — Deterministic slug+keyword matching (0-100)

import Anthropic from '@anthropic-ai/sdk';
import { extractOrgDNA, scoreDNAMatch, resolveInterestTags } from '@/lib/ai/org-dna';
import { MODELS } from '@/lib/ai/prompts';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface OrgContext {
  mission: string;
  focusAreas: string[];
  populations: string[];
  domains: string[];
  geoRegions: string[];
  negativeMatches: string[];
  orgType?: string;
}

export interface OpportunityCandidate {
  id: string;
  title: string;
  description?: string | null;
  categories?: string[] | null;
  target_populations?: string[] | null;
  deadline?: string | null;
  funder?: string | null;
  url?: string | null;
}

export interface ScoredOpportunity {
  opportunity_id: string;
  title: string;
  score: number;        // 1-10
  reasoning: string;
  deadline: string | null;
  funder: string | null;
  url: string | null;
  isNegativeMatch?: boolean;
}

export interface CompanyCandidate {
  id?: string;
  description: string | null;
  interests: string[] | null;
  company_type: string;
}

// Hebrew ↔ English slug mapping (shared across scoring layers)
export const INTEREST_TRANSLATIONS: Record<string, string[]> = {
  'נוער בסיכון': ['youth_at_risk', 'youth at risk'],
  'נוער': ['youth'],
  'צעירים': ['young_adults', 'young adults'],
  'ילדים': ['children'],
  'מוגבלויות': ['disabilities'],
  'קשישים': ['elderly'],
  'עולים': ['immigrants'],
  'ערבים': ['arab'],
  'חרדים': ['haredi'],
  'נשים': ['women'],
  'חיילים': ['soldiers'],
  'סטודנטים': ['students'],
  'אתיופים': ['immigrants', 'ethiopian'],
  'פליטים': ['refugees'],
  'אסירים': ['prisoners'],
  'להטב': ['lgbtq'],
  'חסרי בית': ['homeless'],
  'התמכרות': ['addiction'],
  'חינוך': ['education'],
  'רווחה': ['welfare'],
  'בריאות': ['health'],
  'בריאות הנפש': ['mental_health', 'mental health'],
  'תעסוקה': ['employment'],
  'תרבות': ['culture'],
  'סביבה': ['environment'],
  'טכנולוגיה': ['technology'],
  'קהילה': ['community'],
  'ספורט': ['sport', 'sports'],
  'משפטי': ['legal'],
  'דיור': ['housing'],
  'דו-קיום': ['coexistence'],
  'חדשנות חברתית': ['social_innovation', 'social innovation'],
  'מצוקה חברתית': ['welfare', 'social_distress', 'youth_at_risk'],
  'פיתוח מנהיגות': ['education', 'leadership'],
  'פיתוח קהילתי': ['community'],
  'הוראה': ['education'],
  'מנהיגות': ['education', 'leadership'],
  'מלגות': ['education', 'fellowships'],
  'מחקר': ['science', 'research'],
  'זכויות אדם': ['legal', 'human_rights'],
  'נגב': ['negev'],
  'גליל': ['galilee'],
  'פריפריה': ['periphery'],
  'ירושלים': ['jerusalem'],
  'ארצי': ['national'],
};

// ─────────────────────────────────────────────────────────────
// Mode 1: AI scoring for opportunities (Claude Haiku batch)
// ─────────────────────────────────────────────────────────────

export async function scoreOpportunitiesAI(
  candidates: OpportunityCandidate[],
  orgContextText: string,
): Promise<ScoredOpportunity[]> {
  if (candidates.length === 0) return [];

  const oppList = candidates
    .map(
      (o, i) =>
        `${i + 1}. "${o.title}" | קטגוריות: ${o.categories?.join(', ') || 'לא צוין'} | אוכלוסיות: ${o.target_populations?.join(', ') || 'לא צוין'} | דדליין: ${o.deadline || 'לא צוין'} | גוף: ${o.funder || 'לא ידוע'}`,
    )
    .join('\n');

  const res = await anthropic.messages.create({
    model: MODELS.scoring,
    system: `אתה מומחה גיוס משאבים ישראלי. קיבלת פרופיל מלא של ארגון ספציפי (כולל זיכרון היסטורי, DNA ארגוני, הגשות קודמות) ורשימת קולות קוראים.

דרג כל קול קורא מ-1 עד 10 לפי התאמה **ספציפית** לארגון הזה בלבד.
אסור לדרג לפי "ארגון ממוצע" — רק לפי הפרטים המדויקים של הארגון שבפרופיל.

כללי ציון (היה מחמיר — ציון 7+ רק כשיש חפיפה מוכחת):
- 9-10: התאמה מושלמת — תחום, אוכלוסייה, גודל ואזור תואמים בדיוק לארגון
- 7-8: התאמה גבוהה — תחום ואוכלוסייה תואמים לפרופיל הספציפי
- 5-6: התאמה בינונית — חפיפה ברורה בתחום OR אוכלוסייה בלבד
- 1-4: לא מתאים — אל תכלול ברשימה

קריטריוני דירוג (מחמירים):
- תחום פעילות תואם (40%) — חייב להיות חפיפה אמיתית לתחומי הארגון
- אוכלוסיית יעד תואמת (30%) — האוכלוסייה שהארגון משרת חייבת להתאים
- גודל/סוג הארגון מתאים לדרישות הקול הקורא (15%)
- אזור גיאוגרפי תואם (15%)

שדה reasoning — חובה לציין:
- מה ספציפית בפרופיל הארגון הזה מתאים (לא "ארגון חינוכי" — אלא "עמותת X עובדת עם נוער אתיופי, והקול הקורא מחפש בדיוק זה")
- אם יש מידע מהזיכרון ההיסטורי (הגשות קודמות, הצלחות) — ציין אותו

החזר JSON בלבד — מערך של אובייקטים:
[{"index": 1, "score": 8, "reasoning": "נימוק ספציפי לארגון זה בעברית, 1-2 משפטים"}, ...]

רק פריטים עם ציון 5 ומעלה. אם אין — החזר מערך ריק [].`,
    messages: [
      {
        role: 'user',
        content: `${orgContextText}\n\n===== קולות קוראים פתוחים =====\n${oppList}`,
      },
    ],
    max_tokens: 2000,
  });

  const raw = res.content[0].type === 'text' ? res.content[0].text : '[]';
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
  let scored: { index: number; score: number; reasoning: string }[] = [];
  try {
    scored = JSON.parse(jsonMatch[1]!.trim());
  } catch {
    scored = [];
  }

  const results: ScoredOpportunity[] = [];
  for (const item of scored) {
    if (item.score < 5) continue;
    const opp = candidates[item.index - 1];
    if (!opp) continue;
    results.push({
      opportunity_id: opp.id,
      title: opp.title,
      score: item.score,
      reasoning: item.reasoning,
      deadline: opp.deadline ?? null,
      funder: opp.funder ?? null,
      url: opp.url ?? null,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ─────────────────────────────────────────────────────────────
// Mode 2: DNA + keyword scoring for companies (deterministic)
// Returns 0-100
// ─────────────────────────────────────────────────────────────

export function scoreCompanyDNA(
  company: CompanyCandidate,
  orgCtx: OrgContext,
): number {
  const interests = company.interests || [];

  const resolved = resolveInterestTags(interests);
  const companyDomains = new Set(resolved.domains);
  const companyPopulations = new Set(resolved.populations);

  const translatedInterests: string[] = [];
  for (const interest of interests) {
    const translations = INTEREST_TRANSLATIONS[interest];
    if (translations) translatedInterests.push(...translations);
  }

  const companyText = [
    ...interests,
    ...translatedInterests,
    company.description || '',
  ]
    .join(' ')
    .toLowerCase();

  // Hard reject on negative matches
  for (const neg of orgCtx.negativeMatches) {
    if (companyText.includes(neg.toLowerCase())) return 0;
  }

  let score = 0;

  // Layer 1: Resolved slug matching (language-agnostic)
  for (const pop of orgCtx.populations) {
    if (companyPopulations.has(pop)) score += 25;
    else if (companyText.includes(pop)) score += 15;
  }
  for (const domain of orgCtx.domains) {
    if (companyDomains.has(domain)) score += 22;
    else if (companyText.includes(domain)) score += 12;
  }

  // Layer 2: Geographic overlap
  for (const region of orgCtx.geoRegions) {
    if (companyText.includes(region)) score += 10;
  }

  // Layer 3: Keyword overlap from mission
  for (const kw of orgCtx.focusAreas) {
    if (companyText.includes(kw.toLowerCase())) score += 6;
  }

  // Layer 4: Mission phrase detection
  if (orgCtx.mission) {
    for (const [hebrewPhrase, englishSlugs] of Object.entries(INTEREST_TRANSLATIONS)) {
      if (orgCtx.mission.includes(hebrewPhrase)) {
        const companyMentionsIt =
          companyText.includes(hebrewPhrase) ||
          englishSlugs.some((slug) => companyText.includes(slug)) ||
          englishSlugs.some(
            (slug) => companyDomains.has(slug) || companyPopulations.has(slug),
          );
        if (companyMentionsIt) score += 10;
      }
    }
  }

  // Layer 5: Special signals
  if (company.interests?.includes('israel_grants')) {
    score += score > 15 ? 18 : 4;
  }
  if (company.interests?.includes('federation') && orgCtx.geoRegions.length > 0) {
    score += 8;
  }
  if (company.company_type === 'fund' && score > 10) score += 6;

  // Penalize empty entries
  if (!company.description && interests.length === 0) {
    score = Math.max(0, score - 20);
  }

  return Math.min(100, score);
}

// ─────────────────────────────────────────────────────────────
// Mode 3: DNA scoring for opportunities (deterministic fallback)
// Uses scoreDNAMatch from org-dna.ts, augmented with funder intel
// ─────────────────────────────────────────────────────────────

export interface FunderIntel {
  preferred_domains: string[];
  preferred_populations: string[];
  preferred_org_sizes: string[];
  approval_rate: number;
}

export function scoreOpportunityDNA(
  opp: {
    id: string;
    title: string;
    categories?: string[] | null;
    target_populations?: string[] | null;
    description?: string | null;
    also_relevant_for?: string[] | null;
    deadline?: string | null;
    funder?: string | null;
    url?: string | null;
  },
  orgDna: ReturnType<typeof extractOrgDNA>,
  funderIntel?: FunderIntel,
  outcomeBonus?: number,
): ScoredOpportunity {
  const { score, reasoning, isNegativeMatch } = scoreDNAMatch(
    orgDna,
    (opp.categories as string[]) || [],
    (opp.target_populations as string[]) || [],
    String(opp.title || ''),
    String(opp.description || ''),
    (opp.also_relevant_for as string[]) || [],
  );

  let adjustedScore = score;
  const reasons = [reasoning];

  if (funderIntel && !isNegativeMatch) {
    const domainOverlap = funderIntel.preferred_domains.filter((d) =>
      orgDna.domains.includes(d),
    );
    const popOverlap = funderIntel.preferred_populations.filter((p) =>
      orgDna.populations.includes(p),
    );
    if (domainOverlap.length > 0 || popOverlap.length > 0) {
      const bonus = Math.min(8, (domainOverlap.length + popOverlap.length) * 3);
      adjustedScore += bonus;
      reasons.push(`גוף מממן מעדיף תחומים/אוכלוסיות תואמים (+${bonus})`);
    }
    if (
      funderIntel.preferred_org_sizes.length > 0 &&
      funderIntel.preferred_org_sizes.includes(orgDna.orgType)
    ) {
      adjustedScore += 5;
      reasons.push('גודל ארגון מתאים לגוף מממן (+5)');
    }
  }

  if (outcomeBonus && outcomeBonus > 0 && !isNegativeMatch) {
    adjustedScore += outcomeBonus;
    reasons.push(`ארגונים דומים אושרו אצל גוף זה (+${outcomeBonus})`);
  }

  return {
    opportunity_id: String(opp.id),
    title: String(opp.title || ''),
    score: Math.min(100, adjustedScore),
    reasoning: reasons.join('. '),
    deadline: opp.deadline ?? null,
    funder: opp.funder ?? null,
    url: opp.url ?? null,
    isNegativeMatch,
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers: org profile → OrgContext
// ─────────────────────────────────────────────────────────────

export function buildOrgContextFromProfile(
  profileData: Record<string, unknown>,
  memoryKeywords: string[] = [],
): OrgContext {
  const focusAreas = (profileData.focus_areas as string[]) || [];
  const mission = (profileData.mission as string) || '';
  const geoRegions = (profileData.regions as string[]) || [];
  const dna = (profileData._dna as {
    populations?: string[];
    domains?: string[];
    regions?: string[];
    negative_matches?: string[];
  }) || {};

  const populations = dna.populations || (profileData.populations as string[]) || [];
  const domains = dna.domains || (profileData.domains as string[]) || [];
  const allRegions = [...new Set([...geoRegions, ...(dna.regions || [])])];
  const negativeMatches = dna.negative_matches || [];

  // Auto-expand keywords from mission + memory
  const missionAutoKeywords: string[] = [];
  if (mission) {
    for (const [hebrewKey, englishSlugs] of Object.entries(INTEREST_TRANSLATIONS)) {
      if (mission.includes(hebrewKey)) {
        missionAutoKeywords.push(hebrewKey, ...englishSlugs);
      }
    }
  }

  const translatedOrgKeywords: string[] = [];
  for (const fa of [...focusAreas, ...memoryKeywords]) {
    const translations = INTEREST_TRANSLATIONS[fa];
    if (translations) translatedOrgKeywords.push(...translations);
  }

  const allFocusAreas = [
    ...focusAreas,
    ...memoryKeywords,
    ...missionAutoKeywords,
    ...translatedOrgKeywords,
  ]
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 2);

  return {
    mission,
    focusAreas: allFocusAreas,
    populations,
    domains,
    geoRegions: allRegions,
    negativeMatches,
    orgType: (dna as { orgType?: string }).orgType,
  };
}
