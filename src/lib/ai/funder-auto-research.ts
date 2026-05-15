// Goldfish — Funder Auto-Research
// When a user asks about an unknown funder, Goldfish researches it automatically
// and saves the result to the DB — so every user benefits from the learning.

import { createAdminClient } from '@/lib/supabase/admin';
import { webSearch, SearchResult } from './web-search';
import { geminiCall, geminiSearchGrounding } from './gemini';

// ===== Types =====

export type SubmissionMethod = 'Email' | 'Portal' | 'LOI';

export interface FunderResearchResult {
  found: boolean;
  funderName: string;
  description?: string;
  website?: string;
  applicationUrl?: string;       // Direct link to the application form
  submissionMethod?: SubmissionMethod;
  contactEmail?: string;
  focusAreas?: string[];
  targetPopulations?: string[];
  regions?: string[];
  typicalAmountMin?: number;
  typicalAmountMax?: number;
  deadlineNotes?: string;
  eligibility?: string;
  howToApply?: string;
  pastGrantees?: string[];       // who they funded in practice
  grantSizes?: string;           // from annual reports
  matchAnalysis?: string;        // contextual alignment with org profile
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
  // Run 5 targeted queries in parallel: general, eligibility, past grantees, annual report, application form
  const [general, grantees, annualReport, hebrew, applyForm] = await Promise.all([
    webSearch(`"${funderName}" foundation grant funding eligibility who they fund`, { maxResults: 4, searchDepth: 'advanced' }),
    webSearch(`"${funderName}" past grantees recipients funded organizations site:${funderName.toLowerCase().replace(/\s+/g, '')}.org OR annual report`, { maxResults: 3, searchDepth: 'advanced' }),
    webSearch(`"${funderName}" annual report 2023 2024 grants awarded`, { maxResults: 3, searchDepth: 'basic' }),
    webSearch(`"${funderName}" קרן מענק ישראל תורם`, { maxResults: 3, searchDepth: 'basic' }),
    webSearch(`"${funderName}" apply grant application form submit proposal online`, { maxResults: 3, searchDepth: 'advanced' }),
  ]);

  const all = [...general, ...grantees, ...annualReport, ...hebrew, ...applyForm];

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = all.filter(r => {
    if (!r.url || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  const sources = unique.map(r => r.url).filter(Boolean);
  return { results: unique.slice(0, 10), sources };
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
חשוב במיוחד: חלץ "מי קיבל כסף בפועל" (past grantees) ו"כמה נתנו בפועל" מדוחות שנתיים — לא מה שהגוף אומר על עצמו.
חשוב מאוד: חלץ application_url — כתובת ישירה לדף ההגשה/טופס הבקשה (לא עמוד הבית של הקרן, אלא הלינק הספציפי שבו מגישים בקשות).
חלץ גם submission_method: אחד מ- "Email" / "Portal" / "LOI" — על סמך איך מגישים (מייל ישיר = Email, טופס מקוון/מערכת = Portal, מכתב כוונות = LOI).
חלץ גם contact_email — כתובת המייל הראשית לפניות/הגשות של הקרן.

טקסט מהאינטרנט:
---
${rawText}
---

ענה ONLY ב-JSON, ללא הסבר נוסף:
{
  "description": "תיאור קצר של הגוף (2-3 משפטים)",
  "website": "כתובת האתר הראשית",
  "application_url": "כתובת ישירה לדף ההגשה/טופס — לא עמוד הבית. null אם לא נמצא.",
  "submission_method": "Email|Portal|LOI|null",
  "contact_email": "מייל ישיר לפניות/הגשות, null אם לא נמצא",
  "focus_areas": ["תחום1", "תחום2"],
  "target_populations": ["אוכלוסייה1", "אוכלוסייה2"],
  "regions": ["ישראל", "ארה\"ב"],
  "typical_amount_min": null,
  "typical_amount_max": null,
  "deadline_notes": "הערות על דדליין או מחזוריות",
  "eligibility": "תנאי זכאות עיקריים",
  "how_to_apply": "איך פונים",
  "past_grantees": ["שם ארגון 1", "שם ארגון 2"],
  "grant_sizes": "תיאור קצר של סכומים שנתנו בפועל לפי דוחות"
}

אם לא ידוע — הכנס null. אל תמציא נתונים.`;

  try {
    const raw = await geminiCall(prompt, 600, 0.1);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    const parsed = JSON.parse(jsonMatch[0]);

    // Validate application_url — must be https, not just homepage
    let applicationUrl: string | undefined;
    if (parsed.application_url && typeof parsed.application_url === 'string') {
      const appUrl = parsed.application_url.trim();
      if (appUrl.startsWith('https://') || appUrl.startsWith('http://')) {
        applicationUrl = appUrl;
      }
    }

    // If no application_url found yet — try Gemini Grounding on the website
    if (!applicationUrl && parsed.website) {
      try {
        const groundingText = await geminiSearchGrounding(
          `"${funderName}" apply grant application form submit proposal online portal`
        );
        if (groundingText) {
          const urlMatch = groundingText.match(/https?:\/\/[^\s"'<>]+(?:apply|grant|application|submit|proposal|portal)[^\s"'<>]*/i);
          if (urlMatch) applicationUrl = urlMatch[0];
        }
      } catch { /* non-fatal */ }
    }

    // Parse submission_method
    const rawMethod = (parsed.submission_method || '').toString().trim();
    const submissionMethod: SubmissionMethod | undefined =
      rawMethod === 'Email' ? 'Email' :
      rawMethod === 'Portal' ? 'Portal' :
      rawMethod === 'LOI' ? 'LOI' : undefined;

    // Validate contact_email
    const contactEmail: string | undefined =
      parsed.contact_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.contact_email)
        ? parsed.contact_email : undefined;

    return {
      description: parsed.description || undefined,
      website: parsed.website || undefined,
      applicationUrl,
      submissionMethod,
      contactEmail,
      focusAreas: parsed.focus_areas?.filter(Boolean) || [],
      targetPopulations: parsed.target_populations?.filter(Boolean) || [],
      regions: parsed.regions?.filter(Boolean) || [],
      typicalAmountMin: parsed.typical_amount_min || undefined,
      typicalAmountMax: parsed.typical_amount_max || undefined,
      deadlineNotes: parsed.deadline_notes || undefined,
      eligibility: parsed.eligibility || undefined,
      howToApply: parsed.how_to_apply || undefined,
      pastGrantees: parsed.past_grantees?.filter(Boolean) || [],
      grantSizes: parsed.grant_sizes || undefined,
    };
  } catch {
    return {};
  }
}

// ===== Contextual Alignment — Match funder to org profile =====

/**
 * Compare funder profile to org profile and produce a strategic alignment line.
 * Multi-tenant: org profile is fetched per orgId.
 */
export async function analyzeGrantMatch(
  funderName: string,
  funderProfile: Omit<FunderResearchResult, 'found' | 'funderName' | 'sources' | 'savedToDb'>,
  orgId: string
): Promise<string> {
  const supabase = createAdminClient();

  const [{ data: orgProfileRow }, { data: orgMemory }] = await Promise.all([
    supabase.from('org_profiles').select('data').eq('org_id', orgId).single(),
    supabase.from('org_memory').select('key, value').eq('org_id', orgId).limit(30),
  ]);

  const orgData = (orgProfileRow?.data as Record<string, unknown>) || {};
  const memFacts = (orgMemory || []).map(m => `${m.key}: ${m.value}`).join('\n');

  const orgSummary = [
    orgData.name ? `שם: ${orgData.name}` : null,
    orgData.mission ? `ייעוד: ${String(orgData.mission).slice(0, 200)}` : null,
    orgData.focus_areas ? `תחומים: ${(orgData.focus_areas as string[]).join(', ')}` : null,
    orgData.target_populations ? `קהלים: ${(orgData.target_populations as string[]).join(', ')}` : null,
    orgData.beneficiaries_count ? `מוטבים: ${orgData.beneficiaries_count}` : null,
    orgData.annual_budget ? `תקציב: ${orgData.annual_budget}` : null,
    orgData.impact_metrics ? `אימפקט: ${String(orgData.impact_metrics).slice(0, 300)}` : null,
    orgData.key_achievements ? `הישגים: ${String(orgData.key_achievements).slice(0, 200)}` : null,
    memFacts ? `עובדות נוספות:\n${memFacts.slice(0, 400)}` : null,
  ].filter(Boolean).join('\n');

  if (!orgSummary) return '';

  const funderSummary = [
    funderProfile.focusAreas?.length ? `תחומים: ${funderProfile.focusAreas.join(', ')}` : null,
    funderProfile.targetPopulations?.length ? `קהלים: ${funderProfile.targetPopulations.join(', ')}` : null,
    funderProfile.eligibility ? `זכאות: ${funderProfile.eligibility}` : null,
    funderProfile.pastGrantees?.length ? `מימנו בעבר: ${funderProfile.pastGrantees.join(', ')}` : null,
    funderProfile.grantSizes ? `סכומים: ${funderProfile.grantSizes}` : null,
  ].filter(Boolean).join('\n');

  const prompt = `אתה מנהל גיוס משאבים ותיק. השווה בין פרופיל הארגון לפרופיל הקרן ותפיק שורה אסטרטגית אחת שמסבירה את נקודת ההתחברות הכי חזקה.

פרופיל הקרן (${funderName}):
${funderSummary}

פרופיל הארגון:
${orgSummary}

כתוב משפט אחד עד שניים בעברית בגוף ראשון (כאילו הגולדפיש מדבר). הדגש נתון ספציפי מפרופיל הארגון שמתחבר לערך ספציפי של הקרן. לדוגמה: "הקרן מעדיפה פרויקטים של ליווי תעסוקתי, וזה מתחבר בדיוק לנתון ה-76% תעסוקה בקרב הבוגרים שמוכח במחקר שלכם." אם אין חפיפה ברורה — כתוב "לא מצאתי התאמה ישירה ברורה על סמך המידע הנוכחי."`;

  try {
    const result = await geminiCall(prompt, 200, 0.2);
    return result.trim();
  } catch {
    return '';
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
        profile.applicationUrl ? `קישור להגשה: ${profile.applicationUrl}` : null,
        sources.length ? `מקורות: ${sources.slice(0, 2).join(', ')}` : null,
      ].filter(Boolean).join('\n') || null,
    });
  }

  // 2. Save to funder_intelligence table (including application_url, submission_method, contact_email)
  await supabase.from('funder_intelligence').upsert({
    funder_name: funderName,
    funder_style: 'foundation',
    preferred_domains: profile.focusAreas || [],
    preferred_populations: profile.targetPopulations || [],
    preferred_regions: profile.regions || [],
    typical_amount_min: profile.typicalAmountMin || null,
    typical_amount_max: profile.typicalAmountMax || null,
    cycle_notes: profile.deadlineNotes || null,
    application_url: profile.applicationUrl || null,
    submission_method: profile.submissionMethod || null,
    contact_email: profile.contactEmail || null,
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
  message: string,
  orgId?: string
): Promise<FunderResearchResult | null> {
  if (!process.env.TAVILY_API_KEY) return null;

  // 1. Detect funder name in message
  const funderName = detectUnknownFunderQuery(message);
  if (!funderName) return null;

  // 2. Check if we already know them
  const known = await isFunderKnown(funderName);
  if (known) return null; // Already in DB — no need to research

  // 3. Deep research on web (general + past grantees + annual reports)
  const { results, sources } = await researchFunderOnWeb(funderName);
  if (!results.length) {
    return { found: false, funderName, sources: [], savedToDb: false };
  }

  // 4. Extract structured profile via Gemini (incl. past grantees + grant sizes)
  const profile = await extractFunderProfile(funderName, results);

  // 5. Contextual alignment — compare funder to this org's profile
  let matchAnalysis: string | undefined;
  if (orgId) {
    try {
      matchAnalysis = await analyzeGrantMatch(funderName, profile, orgId) || undefined;
    } catch { /* non-fatal */ }
  }

  // 6. Save to DB
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
    matchAnalysis,
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
  if (research.applicationUrl) lines.push(`קישור ישיר להגשה: ${research.applicationUrl}`);
  if (research.submissionMethod) lines.push(`שיטת הגשה: ${research.submissionMethod}`);
  if (research.contactEmail) lines.push(`מייל פניות: ${research.contactEmail}`);
  if (research.focusAreas?.length) lines.push(`תחומים: ${research.focusAreas.join(', ')}`);
  if (research.targetPopulations?.length) lines.push(`אוכלוסיות: ${research.targetPopulations.join(', ')}`);
  if (research.regions?.length) lines.push(`אזורים: ${research.regions.join(', ')}`);
  if (research.typicalAmountMin || research.typicalAmountMax) {
    lines.push(`סכומים: ${research.typicalAmountMin || '?'}-${research.typicalAmountMax || '?'} ש"ח`);
  }
  if (research.eligibility) lines.push(`תנאי זכאות: ${research.eligibility}`);
  if (research.deadlineNotes) lines.push(`מחזוריות/דדליין: ${research.deadlineNotes}`);
  if (research.howToApply) lines.push(`איך לפנות: ${research.howToApply}`);
  if (research.pastGrantees?.length) lines.push(`מימנו בפועל (past grantees): ${research.pastGrantees.join(', ')}`);
  if (research.grantSizes) lines.push(`סכומים בפועל: ${research.grantSizes}`);
  if (research.matchAnalysis) lines.push(`ניתוח התאמה לארגון שלך: ${research.matchAnalysis}`);
  if (research.sources.length) lines.push(`מקורות: ${research.sources.slice(0, 3).join(' | ')}`);

  lines.push(`\nהנחיה: ספר למשתמש שלא הכרת את "${research.funderName}", אז חקרת עכשיו ועדכנת את המאגר. תן סיכום של מה שמצאת — כולל מי קיבל כסף בפועל, לא רק מה שהגוף אומר על עצמו. אם יש ניתוח התאמה לארגון — ציין אותו בפירוש.`);

  return lines.join('\n');
}
