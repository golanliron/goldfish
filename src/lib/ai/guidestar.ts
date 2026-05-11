// GuideStar Israel — Fetch nonprofit data from data.gov.il open API
// No API key needed — fully public

const RESOURCE_ID = 'be5b7935-3922-45d4-9638-08871b17ec95';
const BASE_URL = 'https://data.gov.il/api/3/action/datastore_search';

export interface GuideStarOrg {
  registration_number: string;
  name_hebrew: string;
  name_english: string | null;
  status: string;
  registration_date: string | null;
  category: string | null;
  purpose: string | null;
  annual_turnover: number | null;
  employees_count: number | null;
  volunteers_count: number | null;
  members_count: number | null;
  city: string | null;
  address: string | null;
  last_financial_report_year: number | null;
}

interface RawRecord {
  'מספר עמותה'?: string;
  'שם עמותה בעברית'?: string;
  'שם עמותה באנגלית'?: string;
  'סטטוס עמותה'?: string;
  'תאריך רישום'?: string;
  'סיווג פעילות ענפי'?: string;
  'מטרות עמותה'?: string;
  'מחזור כספי'?: number;
  'מספר עובדים'?: number;
  'מספר מתנדבים'?: number;
  'מספר חברים'?: number;
  'יישוב'?: string;
  'רחוב'?: string;
  'שנת דוח כספי'?: number;
  [key: string]: unknown;
}

function parseRecord(r: RawRecord): GuideStarOrg {
  return {
    registration_number: r['מספר עמותה'] || '',
    name_hebrew: r['שם עמותה בעברית'] || '',
    name_english: r['שם עמותה באנגלית'] || null,
    status: r['סטטוס עמותה'] || '',
    registration_date: r['תאריך רישום'] || null,
    category: r['סיווג פעילות ענפי'] || null,
    purpose: r['מטרות עמותה'] || null,
    annual_turnover: r['מחזור כספי'] || null,
    employees_count: r['מספר עובדים'] || null,
    volunteers_count: r['מספר מתנדבים'] || null,
    members_count: r['מספר חברים'] || null,
    city: r['יישוב'] || null,
    address: r['רחוב'] || null,
    last_financial_report_year: r['שנת דוח כספי'] || null,
  };
}

/**
 * Fetch nonprofit data by registration number (מספר עמותה)
 */
export async function fetchByRegistrationNumber(regNumber: string): Promise<GuideStarOrg | null> {
  try {
    const clean = regNumber.replace(/\D/g, '');
    if (clean.length < 7) return null;

    const url = `${BASE_URL}?resource_id=${RESOURCE_ID}&q=${clean}&limit=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;

    const data = await res.json();
    const records = data?.result?.records as RawRecord[] | undefined;
    if (!records?.length) return null;

    // Find exact match
    const exact = records.find(r => (r['מספר עמותה'] || '').replace(/\D/g, '') === clean);
    return exact ? parseRecord(exact) : parseRecord(records[0]);
  } catch (e) {
    console.error('[guidestar] Fetch error:', e);
    return null;
  }
}

/**
 * Search nonprofits by name
 */
export async function searchByName(name: string): Promise<GuideStarOrg[]> {
  try {
    if (name.length < 2) return [];

    const url = `${BASE_URL}?resource_id=${RESOURCE_ID}&q=${encodeURIComponent(name)}&limit=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const data = await res.json();
    const records = data?.result?.records as RawRecord[] | undefined;
    if (!records?.length) return [];

    return records
      .filter(r => r['סטטוס עמותה'] === 'רשומה')
      .map(parseRecord);
  } catch (e) {
    console.error('[guidestar] Search error:', e);
    return [];
  }
}

/**
 * Format GuideStar data for org profile enrichment
 */
export function formatForProfile(org: GuideStarOrg): Record<string, unknown> {
  const profile: Record<string, unknown> = {};

  if (org.name_hebrew) profile.name = org.name_hebrew;
  if (org.registration_number) profile.registration_number = org.registration_number;
  if (org.registration_date) {
    const year = org.registration_date.split('/').pop();
    if (year && year.length === 4) profile.founded_year = parseInt(year);
  }
  if (org.purpose) profile.mission = org.purpose;
  if (org.category) profile.focus_areas = [org.category];
  if (org.annual_turnover) profile.annual_budget = org.annual_turnover;
  if (org.employees_count) profile.employees_count = org.employees_count;
  if (org.volunteers_count) profile.volunteers_count = org.volunteers_count;
  if (org.city) profile.regions = [org.city];

  return profile;
}

/**
 * Format GuideStar data as context string for the AI
 */
export function formatForContext(org: GuideStarOrg): string {
  const lines = [
    `\n===== נתוני גיידסטאר (data.gov.il) =====`,
    `שם: ${org.name_hebrew}`,
    org.name_english ? `שם באנגלית: ${org.name_english}` : '',
    `מספר רישום: ${org.registration_number}`,
    `סטטוס: ${org.status}`,
    org.registration_date ? `תאריך רישום: ${org.registration_date}` : '',
    org.category ? `תחום: ${org.category}` : '',
    org.purpose ? `מטרות: ${org.purpose.slice(0, 300)}` : '',
    org.annual_turnover ? `מחזור כספי: ${org.annual_turnover.toLocaleString('he-IL')} ש"ח` : '',
    org.employees_count ? `עובדים: ${org.employees_count}` : '',
    org.volunteers_count ? `מתנדבים: ${org.volunteers_count}` : '',
    org.members_count ? `חברים: ${org.members_count}` : '',
    org.city ? `יישוב: ${org.city}` : '',
    org.last_financial_report_year ? `שנת דוח כספי אחרון: ${org.last_financial_report_year}` : '',
  ].filter(Boolean);

  return lines.join('\n');
}
