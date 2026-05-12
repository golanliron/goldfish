import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Vercel Cron or manual trigger with secret
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = await scanAllSources();
  return Response.json(results);
}

// ============================================================
// SOURCES — Israeli grant aggregators, government, foundations
// ============================================================
const SOURCES = [
  {
    name: 'שתיל',
    url: 'https://shatil.org.il/%D7%A7%D7%A8%D7%A0%D7%95%D7%AA-%D7%95%D7%A7%D7%95%D7%9C%D7%95%D7%AA-%D7%A7%D7%95%D7%A8%D7%90%D7%99%D7%9D/',
    funder: 'שתיל',
  },
  {
    name: 'ביטוח לאומי',
    url: 'https://www.btl.gov.il/Funds/kolotkorim/Pages/default.aspx',
    funder: 'ביטוח לאומי',
  },
  {
    name: 'ג׳וינט ישראל',
    url: 'https://www.jdc.org.il/calls-for-proposals/',
    funder: 'ג׳וינט',
  },
  {
    name: 'רשות החדשנות',
    url: 'https://innovationisrael.org.il/kol-kore/',
    funder: 'רשות החדשנות',
  },
  {
    name: 'gov.il קולות קוראים',
    url: 'https://www.gov.il/he/Departments/DynamicCollectors/kolkore-list',
    funder: '',
  },
  {
    name: 'מפעל הפיס — תרבות',
    url: 'https://culture.pais.co.il/',
    funder: 'מפעל הפיס',
  },
  {
    name: 'קק"ל',
    url: 'https://www.kkl.org.il/about-us/tenders/call-for-proposals/',
    funder: 'קק"ל',
  },
  {
    name: 'משרד החינוך מו"פ',
    url: 'https://mop.education/open-call/',
    funder: 'משרד החינוך',
  },
  {
    name: 'תקומה — שיקום העוטף',
    url: 'https://govextra.gov.il/minisite-new/tkuma-zmani/home/tenders-new/',
    funder: 'רשות תקומה',
  },
  {
    name: 'מפעל הפיס — ספורט',
    url: 'https://www.pais.co.il/sport/calls-for-proposals.aspx',
    funder: 'מפעל הפיס',
  },
  {
    name: 'קרן עזריאלי',
    url: 'https://azrielifoundation.org/our-programs/',
    funder: 'קרן עזריאלי',
  },
  // Federation grant portals — קולות קוראים של פדרציות
  {
    name: 'JUF Chicago - Federation Grants',
    url: 'https://juf.smapply.org/prog/lst/',
    funder: 'JUF Chicago',
  },
  {
    name: 'UJA New York - Grants',
    url: 'https://www.ujafedny.org/resources/grants',
    funder: 'UJA-Federation New York',
  },
  {
    name: 'Jewish Federation Bay Area - Grants',
    url: 'https://jewishfed.org/get-involved/nonprofits/apply-for-a-grant/',
    funder: 'Jewish Federation Bay Area',
  },
  {
    name: 'CJP Boston - Grants',
    url: 'https://www.cjp.org/get-involved/apply-for-a-grant/',
    funder: 'CJP Boston',
  },
  {
    name: 'Jewish Federation Pittsburgh - Grants Portal',
    url: 'https://grantmakingportal.smapply.org/prog/lst/',
    funder: 'Jewish Federation Greater Pittsburgh',
  },
  {
    name: 'UJIA UK - Grants',
    url: 'https://ujia.org/grants/',
    funder: 'UJIA',
  },
  {
    name: 'Rothschild Foundation Europe - Grants',
    url: 'https://rothschildfoundation.eu/grants-page/',
    funder: 'Rothschild Foundation Hanadiv Europe',
  },
  // Gov ministries — specific grant pages
  {
    name: 'משרד הרווחה — תמיכות',
    url: 'https://www.gov.il/he/pages/support-tests-associations',
    funder: 'משרד הרווחה',
  },
  {
    name: 'משרד התרבות — תמיכות',
    url: 'https://www.gov.il/he/pages/ministry_support',
    funder: 'משרד התרבות',
  },
  {
    name: 'משרד הספורט — תמיכות',
    url: 'https://www.gov.il/he/departments/units/sport_support_unit',
    funder: 'משרד התרבות — ספורט',
  },
  {
    name: 'משרד העלייה והקליטה — תמיכות',
    url: 'https://www.gov.il/he/pages/tmichot_mosdot_tzibur',
    funder: 'משרד העלייה והקליטה',
  },
  {
    name: 'ועדת העזבונות',
    url: 'https://www.gov.il/he/departments/topics/allowance_from_the_estates_committee/govil-landing-page',
    funder: 'ועדת העזבונות',
  },
];

// ============================================================
// CONTACT EXTRACTION — phones & emails from page text
// ============================================================
const PHONE_RE = /(?:טלפון|טל|phone|tel)[\s:]*([0-9\-\s()]{7,15})|(?<!\d)(0[2-9]\d?[-\s]?\d{3}[-\s]?\d{4})(?!\d)/g;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const SKIP_EMAILS = new Set(['example@example.com', 'info@info.com', 'test@test.com']);

function extractContactInfo(text: string): string | null {
  const phones: string[] = [];
  for (const m of text.matchAll(PHONE_RE)) {
    const phone = (m[1] || m[2] || '').trim().replace(/[\s()]/g, '');
    if (phone && phone.length >= 7 && !phones.includes(phone)) phones.push(phone);
  }

  const emails: string[] = [];
  for (const m of text.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase();
    if (!SKIP_EMAILS.has(email) && !emails.includes(email)) emails.push(email);
  }

  if (!phones.length && !emails.length) return null;

  const parts: string[] = [];
  if (phones.length) parts.push('tel: ' + phones.slice(0, 3).join(', '));
  if (emails.length) parts.push('email: ' + emails.slice(0, 3).join(', '));
  return parts.join(' | ');
}

// ============================================================
// AUTO-TAGGING — regex patterns matching org-dna.ts
// ============================================================
const POPULATION_PATTERNS: [string, RegExp][] = [
  ['youth_at_risk', /נוער.{0,5}סיכון|צעירים.{0,5}סיכון|נשירה|נושרים|מנותקים/],
  ['youth', /נוער|בני נוער|נערים|נערות|תיכון/],
  ['young_adults', /צעירים|בוגרים צעירים|גיל 18|גיל 26|צעירי|דור צעיר/],
  ['children', /ילדים|ילדות|גן|יסודי|גיל הרך/],
  ['disabilities', /מוגבלות|מוגבלויות|נכות|נכים|שיקום|אוטיזם|אוטיסט|התפתחותי|מיוחד/],
  ['elderly', /קשישים|זקנים|גיל הזהב|גיל שלישי|סיעודי/],
  ['immigrants', /עולים|עלייה|קליטה|יוצאי אתיופיה|אתיופים/],
  ['arab', /ערבי|ערבים|בדואי|בדואים|דרוזי|מגזר ערבי|חברה ערבית/],
  ['haredi', /חרדי|חרדים|חרדית|אולטרא.?אורתודוקס/],
  ['women', /נשים|בנות|מגדר|פמיניז|אלמנות|חד הורי/],
  ['soldiers', /חיילים|משוחררים|צבא|צה"ל|שירות.{0,5}(לאומי|צבאי)|גיוס/],
  ['students', /סטודנטים|אקדמיה|אוניברסיטה|מכללה|לימודים/],
  ['periphery_residents', /פריפריה|נגב|גליל|עוטף|קו עימות/],
  ['homeless', /חסרי בית|דרי רחוב|מחוסרי דיור/],
  ['addiction', /התמכרות|סמים|אלכוהול|גמילה/],
  ['lgbtq', /להט"?ב|גאווה|טרנס|הומו|לסבי/],
  ['refugees', /פליטים|מבקשי מקלט|מהגרים/],
  ['prisoners', /אסירים|כלואים|משוחררי כלא/],
];

const DOMAIN_PATTERNS: [string, RegExp][] = [
  ['education', /חינוך|לימוד|הוראה|בית ספר|אקדמי|השכלה|מלגות|בגרות/],
  ['dropout_prevention', /נשירה|מניעת נשירה|נושרים|מנותקים|שימור/],
  ['welfare', /רווחה|סיוע|ליווי|העצמה|חוסן|שיקום חברתי/],
  ['employment', /תעסוקה|עבודה|הכשרה מקצועית|קריירה|יזמות|הכנסה/],
  ['health', /בריאות|רפואה|נפשי|טיפול|פסיכולוג|רפואי|קליני/],
  ['culture', /תרבות|אמנות|מוזיקה|תיאטרון|קולנוע|ספרות|יצירה/],
  ['environment', /סביבה|אקולוגי|ירוק|קיימות|מיחזור|אקלים/],
  ['technology', /טכנולוגי|דיגיטל|הייטק|תוכנה|מחשב|סייבר|AI/],
  ['community', /קהילה|קהילתי|שכונה|מתנ"ס|מרכז קהילתי|חברתי/],
  ['sport', /ספורט|כדורגל|כדורסל|פעילות גופנית|אתלטיקה/],
  ['legal', /משפטי|זכויות|ייצוג|פרקליט|סיוע משפטי/],
  ['housing', /דיור|שיכון|מגורים|דירה|שכירות/],
  ['mental_health', /בריאות הנפש|נפשי|פסיכולוג|חרדה|דיכאון|טראומה/],
  ['coexistence', /דו.?קיום|שותפות|ערבים.{0,5}יהודים|חברה משותפת/],
  ['social_innovation', /חדשנות חברתית|שינוי חברתי|מוביליות חברתית|אימפקט/],
];

const GEO_PATTERNS: [string, RegExp][] = [
  ['negev', /נגב|באר שבע|ערד|דימונה|רהט|ירוחם|מצפה רמון/],
  ['galilee', /גליל|צפת|כרמיאל|עכו|נהריה|מעלות|קריית שמונה/],
  ['periphery', /פריפריה|שולי|מרוחק|עוטף|קו עימות|גבול/],
  ['center', /מרכז הארץ|תל אביב|גוש דן|רמת גן|פתח תקווה/],
  ['jerusalem', /ירושלים/],
  ['haifa', /חיפה|קריות/],
  ['national', /ארצי|ברחבי הארץ|כלל ארצי|פריסה ארצית/],
];

function autoTagGrant(title: string, description: string, pageText = ''): { categories: string[]; target_populations: string[]; regions: string[] } {
  const text = `${title} ${description} ${pageText}`.toLowerCase();
  const categories = DOMAIN_PATTERNS.filter(([, re]) => re.test(text)).map(([k]) => k);
  const target_populations = POPULATION_PATTERNS.filter(([, re]) => re.test(text)).map(([k]) => k);
  const regions = GEO_PATTERNS.filter(([, re]) => re.test(text)).map(([k]) => k);
  return { categories, target_populations, regions };
}

// AI-powered classification — uses same taxonomy as org-dna.ts
const VALID_CATEGORIES = DOMAIN_PATTERNS.map(([k]) => k);
const VALID_POPULATIONS = POPULATION_PATTERNS.map(([k]) => k);
const VALID_REGIONS = GEO_PATTERNS.map(([k]) => k);

async function classifyGrantWithAI(
  title: string,
  description: string,
  pageText: string
): Promise<{ categories: string[]; target_populations: string[]; regions: string[] } | null> {
  const text = `${title}\n${description}\n${pageText}`.slice(0, 4000);
  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      system: `אתה מסווג קולות קוראים ומענקים לקטגוריות קבועות. החזר JSON בלבד.

הקטגוריות האפשריות (categories — תחומים):
${VALID_CATEGORIES.join(', ')}

אוכלוסיות יעד אפשריות (target_populations):
${VALID_POPULATIONS.join(', ')}

אזורים אפשריים (regions):
${VALID_REGIONS.join(', ')}

חוקים:
- השתמש רק בערכים מהרשימות. אל תמציא ערכים חדשים.
- בחר 1-3 קטגוריות הכי רלוונטיות, לא יותר.
- אם אין אוכלוסיית יעד ברורה — השאר מערך ריק.
- אם אין אזור גאוגרפי — השאר מערך ריק.

החזר:
{"categories": [...], "target_populations": [...], "regions": [...]}`,
      messages: [{ role: 'user', content: text }],
      max_tokens: 200,
    });

    const aiText = res.content[0].type === 'text' ? res.content[0].text : '{}';
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      categories: (parsed.categories || []).filter((k: string) => VALID_CATEGORIES.includes(k)),
      target_populations: (parsed.target_populations || []).filter((k: string) => VALID_POPULATIONS.includes(k)),
      regions: (parsed.regions || []).filter((k: string) => VALID_REGIONS.includes(k)),
    };
  } catch {
    return null;
  }
}

// ============================================================
// TITLE VALIDATION — reject garbage
// ============================================================
function isValidTitle(title: string): boolean {
  if (!title || title.length < 8 || title.length > 200) return false;
  const skip = ['קישור', 'תאריך אחרון', 'מפרסם', 'דף הבית', 'צור קשר', 'אודות', 'חיפוש', 'הרשמה', 'menu', 'search', 'home'];
  const lower = title.toLowerCase();
  return !skip.some(s => lower.includes(s) || title.includes(s));
}

// ============================================================
// GOV.IL JSON EXTRACTION — parses embedded JSON from gov.il pages
// ============================================================
function extractGovIlJson(html: string, defaultFunder: string): ScannedItem[] {
  const results: ScannedItem[] = [];
  const jsonPattern = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  const matches = [...html.matchAll(jsonPattern)];

  for (const match of matches) {
    try {
      const data = JSON.parse(match[1]);
      const items: unknown[] = [];

      if (Array.isArray(data)) {
        items.push(...data);
      } else if (typeof data === 'object' && data !== null) {
        for (const key of ['results', 'items', 'data', 'content']) {
          if (Array.isArray((data as Record<string, unknown>)[key])) {
            items.push(...((data as Record<string, unknown>)[key] as unknown[]));
            break;
          }
        }
      }

      for (const item of items) {
        if (typeof item !== 'object' || item === null) continue;
        const obj = item as Record<string, unknown>;
        const title = String(obj.Title || obj.title || obj.name || '').trim();
        let url = String(obj.Url || obj.url || obj.link || '').trim();
        if (!title || title.length < 8) continue;
        if (url && !url.startsWith('http')) url = `https://www.gov.il${url}`;

        results.push({
          title: title.slice(0, 300),
          description: String(obj.Description || obj.description || '').slice(0, 500) || undefined,
          funder: String(obj.Ministry || obj.ministry || defaultFunder || ''),
          deadline: extractDateStr(String(obj.EndDate || obj.deadline || '')),
          url: url || undefined,
        });
      }
    } catch { /* not valid JSON */ }
  }

  return results;
}

function extractDateStr(text: string): string | undefined {
  if (!text) return undefined;
  const m = text.match(/(\d{1,2})[./](\d{1,2})[./](20\d{2})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  const iso = text.match(/(20\d{2}-\d{2}-\d{2})/);
  return iso ? iso[1] : undefined;
}

// ============================================================
// MAIN SCAN LOGIC
// ============================================================
interface ScannedItem {
  title: string;
  description?: string;
  funder?: string;
  deadline?: string;
  url?: string;
  categories?: string[];
  target_populations?: string[];
  regions?: string[];
  contact_info?: string;
}

async function scanAllSources() {
  const supabase = createAdminClient();
  let totalNew = 0;
  let totalSkipped = 0;
  let deactivated = 0;
  const errors: string[] = [];

  // === Step 1: Cleanup expired ===
  const today = new Date().toISOString().split('T')[0];
  const { data: expired } = await supabase
    .from('opportunities')
    .update({ active: false })
    .lt('deadline', today)
    .eq('active', true)
    .not('deadline', 'is', null)
    .select('id');
  deactivated = expired?.length || 0;

  // === Step 2: Get existing titles for dedup ===
  const { data: existingData } = await supabase
    .from('opportunities')
    .select('title, url')
    .limit(2000);
  const existingTitles = new Set((existingData || []).map(e => e.title?.slice(0, 40)).filter(Boolean));
  const existingUrls = new Set((existingData || []).map(e => e.url).filter(Boolean));

  // === Step 3: Scan all sources ===
  for (const source of SOURCES) {
    try {
      const res = await fetch(source.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        errors.push(`${source.name}: HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();

      // gov.il: try JSON extraction first (faster + more accurate than AI)
      let items: ScannedItem[] = [];
      if (source.url.includes('gov.il')) {
        items = extractGovIlJson(html, source.funder);
      }
      if (items.length === 0) {
        items = await extractOpportunities(html.slice(0, 30000), source.name, source.url);
      }

      for (const item of items) {
        if (!isValidTitle(item.title)) continue;

        // Set funder from source if AI didn't extract one
        if (!item.funder && source.funder) {
          item.funder = source.funder;
        }

        // Dedup: check URL (only specific URLs, not homepages) and title prefix
        const isGenericUrl = item.url && (
          item.url.replace(/\/+$/, '').split('/').length <= 3 || // just domain
          item.url.match(/^https?:\/\/[^/]+\/?$/) // homepage
        );
        if (item.url && !isGenericUrl && existingUrls.has(item.url)) {
          totalSkipped++;
          continue;
        }
        const titlePrefix = item.title.slice(0, 40);
        if (existingTitles.has(titlePrefix)) {
          totalSkipped++;
          continue;
        }

        // Try to extract contact info from the grant page
        let contactInfo: string | null = null;
        let pageText = '';
        if (item.url) {
          try {
            const pageRes = await fetch(item.url, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
              signal: AbortSignal.timeout(10000),
            });
            if (pageRes.ok) {
              const pageHtml = await pageRes.text();
              pageText = pageHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .slice(0, 15000);
              contactInfo = extractContactInfo(pageText);
            }
          } catch { /* page fetch failed, that's ok */ }
        }

        // Classify: AI first (accurate), regex fallback (fast)
        const regexTags = autoTagGrant(item.title, item.description || '', pageText);
        const aiTags = await classifyGrantWithAI(item.title, item.description || '', pageText);

        // Merge: AI takes priority, regex fills gaps
        const finalCategories = aiTags?.categories?.length
          ? [...new Set([...aiTags.categories, ...regexTags.categories])]
          : regexTags.categories.length > 0 ? regexTags.categories : (item.categories || []);
        const finalPopulations = aiTags?.target_populations?.length
          ? [...new Set([...aiTags.target_populations, ...regexTags.target_populations])]
          : regexTags.target_populations.length > 0 ? regexTags.target_populations : (item.target_populations || []);
        const finalRegions = aiTags?.regions?.length
          ? [...new Set([...aiTags.regions, ...regexTags.regions])]
          : regexTags.regions.length > 0 ? regexTags.regions : (item.regions || []);

        const { error: insertErr } = await supabase.from('opportunities').insert({
          title: item.title.slice(0, 300),
          description: item.description?.slice(0, 1000) || null,
          funder: item.funder || null,
          deadline: item.deadline || null,
          url: item.url || null,
          categories: finalCategories,
          target_populations: finalPopulations,
          regions: finalRegions,
          active: true,
          source: source.name,
          type: 'grant',
          contact_info: contactInfo,
        });

        if (!insertErr) {
          totalNew++;
          existingTitles.add(titlePrefix);
          if (item.url) existingUrls.add(item.url);
        }
      }
    } catch (e) {
      errors.push(`${source.name}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  // Log scan
  try {
    await supabase.from('scan_logs').insert({
      new_items: totalNew,
      skipped: totalSkipped,
      errors: errors.length > 0 ? errors : null,
      sources_scanned: SOURCES.length,
    });
  } catch { /* table might not exist */ }

  return {
    scanned: SOURCES.length,
    new_opportunities: totalNew,
    skipped: totalSkipped,
    deactivated_expired: deactivated,
    errors,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================
// AI EXTRACTION — Haiku extracts grants from HTML
// ============================================================
async function extractOpportunities(html: string, sourceName: string, sourceUrl: string): Promise<ScannedItem[]> {
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    system: `אתה מחלץ קולות קוראים ומענקים מדפי HTML.
חוקים קריטיים:
1. חלץ רק קולות קוראים/מענקים/תמיכות פתוחים — לא פרופילים של קרנות, לא דפי מידע כלליים.
2. אם הכותרת היא רק שם קרן (כמו "קרן הדסה") בלי פרטי קול קורא — דלג.
3. חייב לינק ישיר לדף הקול הקורא. לינק לדף הבית של קרן = לא מספיק.
4. חלץ את שם הגוף המממן (funder) — לא את שם הקול קורא.

החזר JSON בלבד — מערך של אובייקטים:
{
  "title": "שם הקול קורא המלא",
  "description": "תיאור קצר (עד 200 תווים)",
  "funder": "שם הגוף המממן",
  "deadline": "YYYY-MM-DD או null",
  "url": "לינק ישיר לדף הקול קורא"
}

אם אין קולות קוראים בדף — החזר מערך ריק [].
לא להמציא. רק מה שרואים בטקסט.`,
    messages: [{
      role: 'user',
      content: `מקור: ${sourceName}\nURL: ${sourceUrl}\n\n${html}`,
    }],
    max_tokens: 4000,
  });

  const text = res.content[0].type === 'text' ? res.content[0].text : '[]';
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];

  try {
    return JSON.parse(jsonMatch[1]!.trim());
  } catch {
    return [];
  }
}
