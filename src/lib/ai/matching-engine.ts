/**
 * Goldfish — 4-Pillar Deep Match Engine
 *
 * Single-opportunity analysis using Gemini Flash.
 * Scores 4 pillars: Eligibility, Mission Alignment, Geography, Capacity.
 * Stores results in the `matches` table per org.
 *
 * Usage:
 *   import { calculateMatchScore, batchMatchOpportunities } from '@/lib/ai/matching-engine';
 */

import { geminiCall } from '@/lib/ai/gemini';
import { createAdminClient } from '@/lib/supabase/admin';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PillarScores {
  eligibility: number;       // 0-100 — can we apply at all?
  mission_alignment: number; // 0-100 — do we do what they fund?
  geography: number;         // 0-100 — do we operate where they give?
  capacity: number;          // 0-100 — is the grant size right for us?
  total: number;             // weighted composite 0-100
  reasoning: string;         // 2-3 sentences in Hebrew
}

export interface MatchResult {
  opportunity_id: string;
  score: number;         // 0-100 (same scale as matches table * 10)
  reasoning: string;
  pillars: PillarScores;
}

interface OpportunityInput {
  id: string;
  title: string;
  funder?: string | null;
  description?: string | null;
  eligibility?: string | null;
  categories?: string[] | null;
  target_populations?: string[] | null;
  regions?: string[] | null;
  amount_min?: number | null;
  amount_max?: number | null;
}

interface OrgProfileInput {
  name?: string;
  mission?: string;
  focus_areas?: string[];
  target_populations?: string[];
  annual_budget?: string | number;
  geographic_focus?: string[];
  age_range?: string;
  employees_count?: string | number;
  theory_of_change?: string;
  [key: string]: unknown;
}

// ─── Core: calculateMatchScore ────────────────────────────────────────────────

export async function calculateMatchScore(
  opportunity: OpportunityInput,
  orgProfile: OrgProfileInput,
  orgMemory: string = '',
): Promise<PillarScores> {

  const orgContext = buildOrgContext(orgProfile, orgMemory);
  const oppContext = buildOppContext(opportunity);

  const prompt = `אתה מומחה גיוס משאבים ישראלי עם ניסיון של 20 שנה. נתח את ההתאמה בין הארגון לקול הקורא לפי 4 עמודות בדיוק.

===== פרופיל הארגון =====
${orgContext}

===== קול הקורא =====
${oppContext}

נתח את 4 העמודות הבאות ותן ציון 0-100 לכל אחת:

1. ELIGIBILITY (משקל 25%) — האם הארגון עומד בתנאי הסף?
   בדוק: גיל הארגון, תקציב שנתי, סוג ישות משפטית, מיקום פעילות ראשי, דרישות ייחודיות.
   100 = עומד בכל התנאים בוודאות. 0 = פסול מוחלט (למשל, קול קורא לחברות בלבד כשהארגון עמותה).

   ⚠️ שלב חשיבה חובה — פוטנציאל שיתוף פעולה אסטרטגי:
   אם תנאי הסף חוסם את הארגון עצמו (למשל: "רשויות מקומיות בלבד", "חברות עסקיות בלבד"),
   אך תוכן הקול הקורא תואם מאוד לתחומי העיסוק של הארגון —
   אל תפסול! במקום זאת, תן eligibility=65 וכלול בנימוק את ההצעה:
   "ניתן להגיש דרך שיתוף פעולה עם [גוף מתאים] שיגיש את הבקשה בעוד הארגון יהיה הגוף המבצע."
   דוגמאות לשיתוף פעולה: רשות מקומית שותפה, מוסד אקדמי, חברה עסקית מממנת, קואליציה עם עמותה מובילה.
   פסול מוחלט (0) רק אם גם התוכן אינו רלוונטי כלל לארגון.

2. MISSION_ALIGNMENT (משקל 40%) — האם מה שהארגון עושה תואם למה שהגוף מממן?
   בדוק: תחומי עיסוק, אוכלוסיות יעד, שיטת התערבות, תפיסת עולם.
   100 = חפיפה מושלמת. 0 = אין כל קשר.

3. GEOGRAPHY (משקל 15%) — האם הארגון פועל באזורים שהגוף מממן?
   100 = תואם מדויק. 50 = חפיפה חלקית. 0 = לא פועל באזור הנדרש.

4. CAPACITY (משקל 20%) — האם גודל המענק מתאים לארגון?
   קטן מדי (<20% מהתקציב השנתי) = 40. אידיאלי (20-40%) = 100. גדול מדי (>200%) = 20.
   אם אין מידע תקציבי — תן 60 כברירת מחדל.

כללי reasoning — חובה לקיים:
- 2-3 משפטים ספציפיים בעברית, לפי הנתונים שניתנו בלבד. אל תכתוב משפטים גנריים.
- ציין מה ספציפית מתאים ומה פחות.
- אם הצעת שיתוף פעולה אסטרטגי — הסבר בבירור מי יגיש ומי יבצע.
- כלל ברזל: אם ה-total (הממוצע המשוקלל) מעל 60 — המשפט הראשון חייב לתאר הזדמנות, לא כישלון. אסור לפתוח ב"לא מתאים" כשהציון גבוה.

החזר JSON בלבד, ללא כל טקסט אחר:
{
  "eligibility": 85,
  "mission_alignment": 70,
  "geography": 90,
  "capacity": 60,
  "total": 76,
  "reasoning": "2-3 משפטים בעברית על ההתאמה הספציפית"
}`;

  try {
    const raw = await geminiCall(prompt, 400, 0);
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error('no JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and clamp all scores
    const clamp = (n: unknown) => Math.min(100, Math.max(0, Number(n) || 0));
    const eligibility      = clamp(parsed.eligibility);
    const mission_alignment = clamp(parsed.mission_alignment);
    const geography        = clamp(parsed.geography);
    const capacity         = clamp(parsed.capacity);

    // Weighted composite: E=25% M=40% G=15% C=20%
    const total = Math.round(
      eligibility * 0.25 +
      mission_alignment * 0.40 +
      geography * 0.15 +
      capacity * 0.20
    );

    let reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';

    // Guard: if score is good but reasoning sounds negative, prefix a corrective label
    if (total >= 60 && /^(לא מתאים|אינו מתאים|הארגון אינו|לא עומד|פסול)/.test(reasoning.trim())) {
      reasoning = `הזדמנות בדרגת התאמה ${total}%: ${reasoning}`;
    }

    return {
      eligibility,
      mission_alignment,
      geography,
      capacity,
      total,
      reasoning,
    };
  } catch {
    // Fallback: return neutral scores so the system doesn't break
    return {
      eligibility: 50,
      mission_alignment: 50,
      geography: 50,
      capacity: 50,
      total: 50,
      reasoning: '',
    };
  }
}

// ─── Batch: score multiple opportunities for one org ─────────────────────────
// Saves results to `matches` table. Non-fatal per item.

export async function batchMatchOpportunities(
  orgId: string,
  opportunities: OpportunityInput[],
  orgProfile: OrgProfileInput,
  orgMemory: string = '',
): Promise<MatchResult[]> {
  const supabase = createAdminClient();
  const results: MatchResult[] = [];

  for (const opp of opportunities) {
    try {
      const pillars = await calculateMatchScore(opp, orgProfile, orgMemory);

      // Only persist if meaningful signal (total >= 40)
      if (pillars.total >= 40) {
        await supabase.from('matches').upsert(
          {
            org_id: orgId,
            opportunity_id: opp.id,
            score: pillars.total,
            reasoning: pillars.reasoning,
            pillars: pillars,        // stored as JSON column
            status: 'new',
            matched_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,opportunity_id' },
        );
      }

      results.push({
        opportunity_id: opp.id,
        score: pillars.total,
        reasoning: pillars.reasoning,
        pillars,
      });
    } catch {
      // Skip failed items — don't block the batch
    }
  }

  return results;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildOrgContext(profile: OrgProfileInput, memory: string): string {
  const lines: string[] = [];
  if (profile.name)              lines.push(`שם: ${profile.name}`);
  if (profile.mission)           lines.push(`מטרה: ${profile.mission}`);
  if (profile.focus_areas?.length)
    lines.push(`תחומי עיסוק: ${profile.focus_areas.join(', ')}`);
  if (profile.target_populations?.length)
    lines.push(`אוכלוסיות יעד: ${profile.target_populations.join(', ')}`);
  if (profile.geographic_focus?.length)
    lines.push(`אזורי פעילות: ${profile.geographic_focus.join(', ')}`);
  if (profile.age_range)         lines.push(`טווח גיל: ${profile.age_range}`);
  if (profile.annual_budget)     lines.push(`תקציב שנתי: ${profile.annual_budget}`);
  if (profile.employees_count)   lines.push(`עובדים: ${profile.employees_count}`);
  if (profile.theory_of_change)  lines.push(`מודל התערבות: ${profile.theory_of_change}`);
  if (memory)                    lines.push(`\nמידע נוסף:\n${memory}`);
  return lines.join('\n') || 'אין מידע על הארגון';
}

function buildOppContext(opp: OpportunityInput): string {
  const lines: string[] = [];
  lines.push(`כותרת: ${opp.title}`);
  if (opp.funder)       lines.push(`גוף מממן: ${opp.funder}`);
  if (opp.description)  lines.push(`תיאור: ${opp.description.slice(0, 600)}`);
  if (opp.eligibility)  lines.push(`תנאי סף: ${opp.eligibility}`);
  if (opp.categories?.length)
    lines.push(`קטגוריות: ${opp.categories.join(', ')}`);
  if (opp.target_populations?.length)
    lines.push(`אוכלוסיות: ${opp.target_populations.join(', ')}`);
  if (opp.regions?.length)
    lines.push(`אזורים: ${opp.regions.join(', ')}`);
  if (opp.amount_min || opp.amount_max) {
    const range = opp.amount_min && opp.amount_max
      ? `${opp.amount_min.toLocaleString()} - ${opp.amount_max.toLocaleString()} ₪`
      : opp.amount_max ? `עד ${opp.amount_max.toLocaleString()} ₪` : `מ-${opp.amount_min?.toLocaleString()} ₪`;
    lines.push(`סכום: ${range}`);
  }
  return lines.join('\n');
}
