// Profile Autopilot — extracts org profile fields from uploaded documents
// Called from process-upload after text parsing, before org_memory seeding.
//
// Patch strategy:
//   - Only fields with high-confidence values are returned
//   - Strings: new wins only if longer (more detailed)
//   - Numbers: new wins only if document year >= existing data_as_of year
//   - Arrays: union merge — existing items never removed
//   - ngo_number: immutable once set

import { geminiCall } from './gemini';
import type { OrgProfileData } from '@/types';

// Fields this module actively targets — superset of what geminiExtract covers.
// Organized by importance so the prompt is easy to maintain.
const EXTRACTION_PROMPT = (text: string, currentProfile: Partial<OrgProfileData>, orgName?: string) => `
אתה מומחה לניתוח מסמכים של עמותות וארגונים חברתיים.
המטרה: לחלץ מהמסמך שדות ספציפיים לפרופיל הארגון, בדיוק גבוה בלבד.
${orgName ? `שם הארגון: "${orgName}". חלץ רק נתונים שמתייחסים לארגון הזה.` : ''}

פרופיל קיים (אל תחזיר שדות שכבר מולאו, אלא אם המסמך מכיל גרסה עדכנית ומפורטת יותר):
${JSON.stringify(currentProfile, null, 2).slice(0, 3000)}

שדות לחיפוש במסמך:

זהות:
- ngo_number: מספר עמותה רשמי (9 ספרות, למשל: 580123456)
- registration_number: מספר ח"פ / מספר רישום (אם שונה מ-ngo_number)
- founded_year: שנת הקמה מקורית (4 ספרות)
- mission: ייעוד מרכזי (1-3 משפטים, לא סלוגן)

אנשים:
- ceo_name: שם המנכ"ל/ית הנוכחי/ת
- board_members: רשימת חברי ועד מנהל (מערך של שמות)
- contact_name: איש קשר ראשי
- contact_email: מייל ראשי
- contact_phone: טלפון ראשי
- website: אתר אינטרנט

תקציב ופעילות:
- data_as_of: שנת הנתונים במסמך (4 ספרות — השנה שאליה מתייחס הדוח/תקציב, לא שנת ההדפסה)
- annual_budget: תקציב שנתי כולל (מספר בשקלים, לא מחרוזת)
- beneficiaries_count: מספר מוטבים/נהנים שנתי (מספר שלם)
- employees_count: מספר עובדים (מספר שלם)
- cities_active: ערים/אזורים פעילים (מערך)
- regions: אזורי פעילות גיאוגרפיים (מערך)

תוכניות ואימפקט:
- focus_areas: תחומי פעילות (מערך)
- target_populations: אוכלוסיות יעד (מערך)
- key_achievements: הישגים מרכזיים (מערך של משפטים קצרים)
- certifications: אישורים בתוקף — ניהול תקין, סעיף 46, ניכוי מס (מערך)

כללים:
1. החזר JSON תקני בלבד — ללא markdown, ללא הסברים
2. כלול רק שדות שמצאת במסמך עם ביטחון גבוה
3. אל תשער — אם לא כתוב במפורש, אל תכלול
4. מספרים: annual_budget ו-beneficiaries_count חייבים להיות מספרים (לא מחרוזות עם ₪)
5. אם annual_budget מופיע בטקסט כ-"360,000" — החזר 360000
6. board_members: רק שמות שמוגדרים במפורש כחברי ועד
7. data_as_of: אם הדוח הוא "דוח שנתי 2023" — החזר 2023. אם לא ברור — אל תכלול

מסמך לניתוח:
${text.slice(0, 25000)}
`.trim();

// ===== Patch logic =====
// Rules per field type:
// - string: new wins if longer AND non-empty
// - number: new wins if > 0 AND (existing is 0/undefined OR new is larger — newer doc is more authoritative)
// - string[]: merge (union), deduplicate
// - Special: ngo_number — immutable once set (NGO numbers don't change)

function patchStringField(existing: string | undefined, incoming: string | undefined): string | undefined {
  if (!incoming || incoming.trim().length === 0) return existing;
  if (!existing || existing.trim().length === 0) return incoming.trim();
  // New value wins only if meaningfully longer (more detailed)
  return incoming.trim().length > existing.trim().length ? incoming.trim() : existing;
}

// incomingYear: year extracted from the document (data_as_of)
// existingYear: year stored in current profile (data_as_of)
// Rule: incoming wins only if its year >= existing year (newer or same period)
function patchNumberField(
  existing: number | undefined,
  incoming: number | undefined,
  incomingYear?: number,
  existingYear?: number
): number | undefined {
  if (!incoming || incoming <= 0) return existing;
  if (!existing || existing <= 0) return incoming; // nothing to protect

  // If we have year info on both sides — use it
  if (incomingYear && existingYear) {
    return incomingYear >= existingYear ? incoming : existing;
  }
  // If only the incoming doc has a year, trust it
  if (incomingYear) return incoming;
  // No year info at all — incoming wins (latest upload = most recent intent)
  return incoming;
}

function patchArrayField(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  if (!incoming || incoming.length === 0) return existing;
  if (!existing || existing.length === 0) return incoming;
  // Union merge, deduplication by lowercased value
  const seen = new Set(existing.map(s => s.toLowerCase().trim()));
  const merged = [...existing];
  for (const item of incoming) {
    if (item && !seen.has(item.toLowerCase().trim())) {
      merged.push(item);
      seen.add(item.toLowerCase().trim());
    }
  }
  return merged;
}

export function patchProfile(
  current: Partial<OrgProfileData>,
  incoming: Partial<OrgProfileData>
): { patched: Partial<OrgProfileData>; updates: ProfileUpdate[] } {
  const result: Partial<OrgProfileData> = { ...current };
  const updates: ProfileUpdate[] = [];

  // Extract document years for numeric field comparison
  const incomingYear = incoming.data_as_of as number | undefined;
  const existingYear = current.data_as_of as number | undefined;

  const STRING_FIELDS: (keyof OrgProfileData)[] = [
    'mission', 'ceo_name', 'contact_name', 'contact_email',
    'contact_phone', 'website', 'ngo_number', 'registration_number',
  ];
  const NUMBER_FIELDS: (keyof OrgProfileData)[] = [
    'annual_budget', 'beneficiaries_count', 'employees_count', 'founded_year',
  ];
  const ARRAY_FIELDS: (keyof OrgProfileData)[] = [
    'board_members', 'focus_areas', 'target_populations', 'regions',
    'key_achievements', 'certifications', 'cities_active',
  ];

  // Special: ngo_number is immutable once set
  const IMMUTABLE: (keyof OrgProfileData)[] = ['ngo_number'];

  for (const key of STRING_FIELDS) {
    if (IMMUTABLE.includes(key) && current[key]) continue; // never overwrite
    const prev = current[key] as string | undefined;
    const next = incoming[key] as string | undefined;
    const patched = patchStringField(prev, next);
    if (patched && patched !== prev) {
      (result as Record<string, unknown>)[key] = patched;
      updates.push({ field: key, value: patched, previous: prev });
    }
  }

  // Also update data_as_of if the incoming document is newer
  if (incomingYear && (!existingYear || incomingYear > existingYear)) {
    (result as Record<string, unknown>).data_as_of = incomingYear;
    if (incomingYear !== existingYear) {
      updates.push({ field: 'data_as_of' as keyof OrgProfileData, value: incomingYear, previous: existingYear });
    }
  }

  for (const key of NUMBER_FIELDS) {
    const prev = current[key] as number | undefined;
    const next = incoming[key] as number | undefined;
    const patched = patchNumberField(prev, next, incomingYear, existingYear);
    if (patched !== undefined && patched !== prev) {
      (result as Record<string, unknown>)[key] = patched;
      updates.push({ field: key, value: patched, previous: prev });
    }
  }

  for (const key of ARRAY_FIELDS) {
    const prev = current[key] as string[] | undefined;
    const next = incoming[key] as string[] | undefined;
    const patched = patchArrayField(prev, next);
    if (patched && JSON.stringify(patched) !== JSON.stringify(prev)) {
      (result as Record<string, unknown>)[key] = patched;
      const added = patched.filter(v => !prev?.includes(v));
      if (added.length > 0) {
        updates.push({ field: key, value: added, previous: prev });
      }
    }
  }

  return { patched: result, updates };
}

// ===== Main extraction function =====

export interface ProfileUpdate {
  field: keyof OrgProfileData;
  value: unknown;
  previous: unknown;
}

export interface ProfileAutopilotResult {
  extracted: Partial<OrgProfileData>;
  updates: ProfileUpdate[];
  patched: Partial<OrgProfileData>;
  summary: string; // human-readable Hebrew summary for toast
}

export async function extractProfileData(
  parsedText: string,
  currentProfile: Partial<OrgProfileData>,
  orgName?: string
): Promise<ProfileAutopilotResult> {
  const empty: ProfileAutopilotResult = {
    extracted: {},
    updates: [],
    patched: currentProfile,
    summary: '',
  };

  if (parsedText.length < 50) return empty;

  let raw = '';
  try {
    raw = await geminiCall(
      EXTRACTION_PROMPT(parsedText, currentProfile, orgName),
      2000,
      0
    );
  } catch {
    return empty;
  }

  let extracted: Partial<OrgProfileData> = {};
  try {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
    const parsed = JSON.parse(jsonMatch[1]!.trim());

    // Sanitize: ensure numbers are numbers
    if (typeof parsed.annual_budget === 'string') {
      parsed.annual_budget = parseInt(parsed.annual_budget.replace(/[^\d]/g, ''), 10) || undefined;
    }
    if (typeof parsed.beneficiaries_count === 'string') {
      parsed.beneficiaries_count = parseInt(parsed.beneficiaries_count.replace(/[^\d]/g, ''), 10) || undefined;
    }
    if (typeof parsed.employees_count === 'string') {
      parsed.employees_count = parseInt(parsed.employees_count.replace(/[^\d]/g, ''), 10) || undefined;
    }
    if (typeof parsed.founded_year === 'string') {
      parsed.founded_year = parseInt(parsed.founded_year, 10) || undefined;
    }
    if (typeof parsed.data_as_of === 'string') {
      parsed.data_as_of = parseInt(parsed.data_as_of, 10) || undefined;
    }
    // Sanity check: data_as_of must be a plausible year (1980–current+1)
    const currentYear = new Date().getFullYear();
    if (parsed.data_as_of && (parsed.data_as_of < 1980 || parsed.data_as_of > currentYear + 1)) {
      parsed.data_as_of = undefined;
    }

    extracted = parsed;
  } catch {
    return empty;
  }

  const { patched, updates } = patchProfile(currentProfile, extracted);

  // Build human-readable Hebrew summary
  const summary = buildUpdateSummary(updates);

  return { extracted, updates, patched, summary };
}

// ===== Summary builder =====

const FIELD_LABELS: Partial<Record<keyof OrgProfileData, string>> = {
  annual_budget: 'תקציב שנתי',
  beneficiaries_count: 'מספר מוטבים',
  employees_count: 'מספר עובדים',
  mission: 'ייעוד הארגון',
  ceo_name: 'שם המנכ"ל/ית',
  board_members: 'חברי ועד',
  ngo_number: 'מספר עמותה',
  registration_number: 'מספר ח"פ',
  founded_year: 'שנת הקמה',
  contact_email: 'כתובת מייל',
  contact_phone: 'טלפון',
  website: 'אתר אינטרנט',
  focus_areas: 'תחומי פעילות',
  target_populations: 'אוכלוסיות יעד',
  regions: 'אזורי פעילות',
  key_achievements: 'הישגים',
  certifications: 'אישורים',
  cities_active: 'ערים פעילות',
};

function formatValue(field: keyof OrgProfileData, value: unknown): string {
  if (field === 'annual_budget' && typeof value === 'number') {
    return `₪${value.toLocaleString('he-IL')}`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 3).join(', ') + (value.length > 3 ? ` ועוד ${value.length - 3}` : '');
  }
  return String(value).slice(0, 80);
}

function buildUpdateSummary(updates: ProfileUpdate[]): string {
  if (updates.length === 0) return '';

  const parts = updates
    .filter(u => FIELD_LABELS[u.field])
    .slice(0, 5) // cap at 5 items for readability
    .map(u => {
      const label = FIELD_LABELS[u.field];
      const val = formatValue(u.field, u.value);
      return `${label}: ${val}`;
    });

  if (parts.length === 0) return '';

  return `גיליתי מהמסמך: ${parts.join(' | ')} — ועדכנתי את הפרופיל שלכם.`;
}
