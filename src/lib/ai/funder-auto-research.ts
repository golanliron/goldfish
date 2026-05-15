// Goldfish — Funder Auto-Research
// When a user asks about an unknown funder, Goldfish researches it automatically
// and saves the result to the DB — so every user benefits from the learning.

import { createAdminClient } from '@/lib/supabase/admin';
import { webSearch, SearchResult } from './web-search';
import { geminiCall } from './gemini';

// ===== Types =====

export interface FunderResearchResult {
  found: boolean;
  funderName: string;
  description?: string;
  website?: string;
  focusAreas?: string[];
  targetPopulations?: string[];
  regions?: string[];
  typicalAmountMin?: number;
  typicalAmountMax?: number;
  deadlineNotes?: string;
  eligibility?: string;
  howToApply?: string;
  sources: string[];
  savedToDb: boolean;
}

// ===== Detection =====

/**
 * Detect if a message is asking about a specific named funder that we might not know.
 * Returns the funder name, or null.
 */
export function detectUnknownFunderQuery(message: string): string | null {
  // Patterns: "מה זה קרן X", "ספר לי על X foundation", "Benecare Foundation מה זה"
  const patterns = [
    /(?:מה (?:זה|היא|עושה)|ספר (?:לי )?על|מידע על|חקור את|בדוק את|מי הם)\s+(.{3,60}?)(?:\?|$|\s*[-–])/i,
    /^(.{3,60}?)\s+(?:קרן|foundation|fund|trust|charitable|philanthropy)/i,
    /(?:קרן|foundation|fund|trust)\s+(.{3,60?)(?:\?|$)/i,
    // English: "tell me about X", "who is X foundation", "what is X"
    /(?:tell me about|who (?:is|are)|what is|research)\s+(.{3,60}?)(?:\?|$)/i,
    // Name appears in isolation with question context
    /^([A-Z][a-zA-Z\s]{3,40}(?:Foundation|Fund|Trust|Charitable|Philanthropy|Family Foundation))\b/,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim();
      // Filter out generic terms
      if (['הקרן', 'קרן', 'foundation', 'fund', 'trust', 'גוף מממן', 'גופים'].includes(candidate.toLowerCase())) continue;
      if (candidate.length < 3) continue;
      return candidate;
    }
  }

  return null;
}

/**
 * Check if we already know this funder (in companies or funder_intelligence tables).
 */
async function isFunderKnown(funderName: string): Promise<boolean> {
  const supabase = createAdminClient();
  const name = funderName.trim();

  const [{ data: inCompanies }, { data: inIntelligence }] = await Promise.all([
    supabase
      .from('companies')
      .select('id')
      .or(`name.ilike.%${name}%`)
      .limit(1),
    supabase
      .from('funder_intelligence')
      .select('funder_name')
      .ilike('funder_name', `%${name}%`)
      .limit(1),
  ]);

  return !!(inCompanies?.length || inIntelligence?.length);
}

// ===== Research =====

/**
 * Research a funder using Tavily web search.
 */
async function researchFunderOnWeb(funderName: string): Promise<{ results: SearchResult[]; sources: string[] }> {
  const queries = [
    `"${funderName}" foundation grant funding eligibility`,
    `"${funderName}" קרן מענק ישראל`,
    `${funderName} charitable foundation who they fund`,
  ];

  const allResults: SearchResult[] = [];
  for (const q of queries.slice(0, 2)) {
    const res = await webSearch(q, { maxResults: 4, searchDepth: 'advanced' });
    allResults.push(...res);
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = allResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  const sources = unique.map(r => r.url).filter(Boolean);
  return { results: unique.slice(0, 6), sources };
}

/**
 * Use Gemini to extract structured data from raw search results.
 */
async function extractFunderProfile(
  funderName: string,
  searchResults: SearchResult[]
): Promise<Omit<FunderResearchResult, 'found' | 'funderName' | 'sources' | 'savedToDb'>> {
  if (!searchResults.length) return {};

  const rawText = searchResults
    .map(r => `${r.title}\n${r.content}`)
    .join('\n\n---\n\n')
    .slice(0, 8000);

  const prompt = `אתה מומחה לניתוח גופים פילנתרופיים. מהטקסט הבא, חלץ מידע על "${funderName}".

טקסט מהאינטרנט:
---
${rawText}
---

ענה ONLY ב-JSON, ללא הסבר נוסף:
{
  "description": "תיאור קצר של הגוף (2-3 משפטים)",
  "website": "כתובת האתר אם מוזכרת",
  "focus_areas": ["תחום1", "תחום2"],
  "target_populations": ["אוכלוסייה1", "אוכלוסייה2"],
  "regions": ["ישראל", "ארה\"ב"],
  "typical_amount_min": null,
  "typical_amount_max": null,
  "deadline_notes": "הערות על דדליין או מחזוריות",
  "eligibility": "תנאי זכאות עיקריים",
  "how_to_apply": "איך פונים"
}

אם לא ידוע — הכנס null. אל תמציא נתונים.`;

  try {
    const raw = await geminiCall(prompt, 600, 0.1);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      description: parsed.description || undefined,
      website: parsed.website || undefined,
      focusAreas: parsed.focus_areas?.filter(Boolean) || [],
      targetPopulations: parsed.target_populations?.filter(Boolean) || [],
      regions: parsed.regions?.filter(Boolean) || [],
      typicalAmountMin: parsed.typical_amount_min || undefined,
      typicalAmountMax: parsed.typical_amount_max || undefined,
      deadlineNotes: parsed.deadline_notes || undefined,
      eligibility: parsed.eligibility || undefined,
      howToApply: parsed.how_to_apply || undefined,
    };
  } catch {
    return {};
  }
}

// ===== Ingestion =====

/**
 * Save discovered funder to companies + funder_intelligence tables.
 */
async function saveFunderToDb(
  funderName: string,
  profile: Omit<FunderResearchResult, 'found' | 'funderName' | 'sources' | 'savedToDb'>,
  sources: string[]
): Promise<void> {
  const supabase = createAdminClient();

  // 1. Save to companies table (as a fund)
  const { data: existing } = await supabase
    .from('companies')
    .select('id')
    .ilike('name', `%${funderName}%`)
    .limit(1);

  if (!existing?.length) {
    await supabase.from('companies').insert({
      name: funderName,
      description: profile.description || `גוף פילנתרופי: ${funderName}`,
      website: profile.website || null,
      company_type: 'fund',
      tags: profile.focusAreas || [],
      notes: [
        profile.eligibility ? `זכאות: ${profile.eligibility}` : null,
        profile.deadlineNotes ? `מחזוריות: ${profile.deadlineNotes}` : null,
        profile.howToApply ? `איך לפנות: ${profile.howToApply}` : null,
        sources.length ? `מקורות: ${sources.slice(0, 2).join(', ')}` : null,
      ].filter(Boolean).join('\n') || null,
    });
  }

  // 2. Save to funder_intelligence table
  await supabase.from('funder_intelligence').upsert({
    funder_name: funderName,
    funder_style: 'foundation',
    preferred_domains: profile.focusAreas || [],
    preferred_populations: profile.targetPopulations || [],
    preferred_regions: profile.regions || [],
    typical_amount_min: profile.typicalAmountMin || null,
    typical_amount_max: profile.typicalAmountMax || null,
    cycle_notes: profile.deadlineNotes || null,
    recurring_months: [],
    total_submissions: 0,
    total_approved: 0,
    total_rejected: 0,
    writing_tips: profile.howToApply || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'funder_name' });
}

// ===== Main Entry Point =====

/**
 * Auto-research a funder if unknown. Returns structured result with a flag
 * indicating whether it was newly discovered (for chat notification).
 *
 * Usage in chat route:
 *   const research = await autoResearchFunder(message);
 *   if (research) inject into systemPrompt as context
 */
export async function autoResearchFunder(
  message: string
): Promise<FunderResearchResult | null> {
  if (!process.env.TAVILY_API_KEY) return null;

  // 1. Detect funder name in message
  const funderName = detectUnknownFunderQuery(message);
  if (!funderName) return null;

  // 2. Check if we already know them
  const known = await isFunderKnown(funderName);
  if (known) return null; // Already in DB — no need to research

  // 3. Research on web
  const { results, sources } = await researchFunderOnWeb(funderName);
  if (!results.length) {
    return { found: false, funderName, sources: [], savedToDb: false };
  }

  // 4. Extract structured profile via Gemini
  const profile = await extractFunderProfile(funderName, results);

  // 5. Save to DB
  let savedToDb = false;
  try {
    await saveFunderToDb(funderName, profile, sources);
    savedToDb = true;
  } catch (e) {
    console.error('[funder-auto-research] DB save failed:', e);
  }

  return {
    found: true,
    funderName,
    ...profile,
    sources,
    savedToDb,
  };
}

/**
 * Format research result for injection into system prompt.
 */
export function formatFunderResearch(research: FunderResearchResult): string {
  if (!research.found) return '';

  const lines = [
    `\n\n===== מחקר חדש: ${research.funderName} =====`,
    `[גולדפיש חקר את הגוף הזה עכשיו ועדכן את המאגר]`,
  ];

  if (research.description) lines.push(`תיאור: ${research.description}`);
  if (research.website) lines.push(`אתר: ${research.website}`);
  if (research.focusAreas?.length) lines.push(`תחומים: ${research.focusAreas.join(', ')}`);
  if (research.targetPopulations?.length) lines.push(`אוכלוסיות: ${research.targetPopulations.join(', ')}`);
  if (research.regions?.length) lines.push(`אזורים: ${research.regions.join(', ')}`);
  if (research.typicalAmountMin || research.typicalAmountMax) {
    lines.push(`סכומים: ${research.typicalAmountMin || '?'}-${research.typicalAmountMax || '?'} ש"ח`);
  }
  if (research.eligibility) lines.push(`תנאי זכאות: ${research.eligibility}`);
  if (research.deadlineNotes) lines.push(`מחזוריות/דדליין: ${research.deadlineNotes}`);
  if (research.howToApply) lines.push(`איך לפנות: ${research.howToApply}`);
  if (research.sources.length) lines.push(`מקורות: ${research.sources.slice(0, 2).join(' | ')}`);

  lines.push(`\nהנחיה: ספר למשתמש שלא הכרת את הגוף הזה, אז חקרת עכשיו ועדכנת את המאגר. תן סיכום של מה שמצאת.`);

  return lines.join('\n');
}
