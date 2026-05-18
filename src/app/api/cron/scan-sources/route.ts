import { NextRequest } from 'next/server';

export const maxDuration = 300; // 5 minutes — Vercel Pro limit

import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { geminiOcrPdf } from '@/lib/ai/gemini';
import { analyzeGrantMatch } from '@/lib/ai/funder-auto-research';
import { withRetry } from '@/lib/ai/retry';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Vercel Cron or manual trigger
// Supports ?batch=0,1,2... to scan sources in chunks
// Supports ?source=gov|shatil|kkl|pais|jdc|shefi|... to scan a single source group
const SOURCE_KEY_MAP: Record<string, string[]> = {
  gov:        ['gov.il', 'משרד', 'רשות', 'שפ"י', 'תקומה', 'ועדת', 'govextra'],
  shatil:     ['שתיל'],
  kkl:        ['קק"ל'],
  pais:       ['מפעל הפיס', 'pais'],
  jdc:        ['ג׳וינט', 'jdc'],
  shefi:      ['שפ"י'],
  rothschild: ['Rothschild'],
  federation: ['Federation'],
  socialmap:  ['SocialMap'],
  guidestar:  ['גיידסטאר'],
};

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const reqUrl = new URL(request.url);
  const batchParam = reqUrl.searchParams.get('batch');
  const sourceParam = reqUrl.searchParams.get('source');
  const batchIndex = batchParam !== null ? parseInt(batchParam) : -1;

  if (sourceParam) {
    return Response.json(await scanSingleSource(sourceParam));
  }

  return Response.json(await scanAllSources(batchIndex >= 0 ? batchIndex : undefined));
}

async function scanSingleSource(sourceKey: string) {
  const keywords = SOURCE_KEY_MAP[sourceKey.toLowerCase()];
  const activeSources = SOURCES.filter(s => !s.disabled);

  const matchedSources = keywords
    ? activeSources.filter(s => keywords.some(kw => s.name.includes(kw) || s.url.includes(kw)))
    : activeSources.filter(s =>
        s.name.toLowerCase().includes(sourceKey.toLowerCase()) ||
        s.url.toLowerCase().includes(sourceKey.toLowerCase())
      );

  if (matchedSources.length === 0) {
    return {
      error: `No sources matched key: "${sourceKey}"`,
      available_keys: Object.keys(SOURCE_KEY_MAP),
      active_sources: activeSources.map(s => s.name),
    };
  }

  const result = await scanAllSources(undefined, matchedSources);
  return { source: sourceKey, matched_sources: matchedSources.map(s => s.name), ...result };
}

// ============================================================
// SOURCES — Israeli grant aggregators, government, foundations
// ============================================================
// ============================================================
// SOURCE PIPELINE TIERS
// approved_pipeline  — QA passed, runs daily automatically
// next_dryrun        — pending DryRun before auto-save enabled (dryRun: true)
// browser_required   — JS-rendered, needs Playwright (disabled: true)
// funder_profile_only — no open call, do not save as opportunity
// ============================================================

interface Source {
  name: string;
  url: string;
  funder: string;
  dryRun?: boolean;    // true = scan but never write to DB (DryRun mode)
  disabled?: boolean;  // true = skip entirely (browser_required or not ready)
}

const SOURCES: Source[] = [
  // ── approved_pipeline ──────────────────────────────────────
  {
    name: 'שתיל',
    url: 'https://shatil.org.il/%D7%A7%D7%A8%D7%A0%D7%95%D7%AA-%D7%95%D7%A7%D7%95%D7%9C%D7%95%D7%AA-%D7%A7%D7%95%D7%A8%D7%90%D7%99%D7%9D/',
    funder: 'שתיל',
  },
  // btl DISABLED 2026-05-17: full-site crawl produced 115 benefit pages, not grant opportunities.
  // btl.gov.il is a citizen-benefit site, not a source for nonprofit grants.
  // {
  //   name: 'ביטוח לאומי',
  //   url: 'https://www.btl.gov.il/Funds/kolotkorim/Pages/default.aspx',
  //   funder: 'ביטוח לאומי',
  // },
  {
    name: 'ג׳וינט ישראל',
    url: 'https://www.jdc.org.il/calls-for-proposals/',
    funder: 'ג׳וינט',
  },
  {
    name: 'רשות החדשנות — gov.il',
    url: 'https://www.gov.il/he/departments/topics/innovation-authority-programs/govil-landing-page',
    funder: 'רשות החדשנות',
  },
  {
    name: 'gov.il קולות קוראים',
    url: 'https://www.gov.il/he/Departments/DynamicCollectors/kolkore-list',
    funder: '',
  },
  // pais DISABLED 2026-05-17: pais.co.il/culture/tenders.aspx caused full-site crawl including
  // /archive/grantsfolder/ (2019-2022 past grants). Use culture.pais.co.il with /kolot/ filter only.
  // {
  //   name: 'מפעל הפיס — תרבות',
  //   url: 'https://www.pais.co.il/culture/tenders.aspx',
  //   funder: 'מפעל הפיס',
  // },
  {
    // kkl: entry point is correct (/about-us/tenders/call-for-proposals/) but crawler must NOT
    // follow links outside /about-us/tenders/ — see crawl depth/domain filter in scanner logic.
    name: 'קק"ל',
    url: 'https://www.kkl.org.il/about-us/tenders/call-for-proposals/',
    funder: 'קק"ל',
  },
  {
    name: 'משרד החינוך — gov.il',
    url: 'https://www.gov.il/he/departments/topics/education-tenders/govil-landing-page',
    funder: 'משרד החינוך',
  },
  {
    name: 'תקומה — שיקום העוטף',
    url: 'https://govextra.gov.il/minisite-new/tkuma-zmani/home/tenders-new/',
    funder: 'רשות תקומה',
  },
  // pais scholarships DISABLED 2026-05-17: same crawl issue as culture URL above.
  // {
  //   name: 'מפעל הפיס — מלגות',
  //   url: 'https://www.pais.co.il/scholarships/tenders.aspx',
  //   funder: 'מפעל הפיס',
  // },
  // International foundations — verified working URLs
  {
    name: 'Jewish Federation Bay Area - Grants',
    url: 'https://jewishfed.org/get-involved/nonprofits/apply-for-a-grant/',
    funder: 'Jewish Federation Bay Area',
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
  {
    name: 'משרד האוצר — תמיכות',
    url: 'https://www.gov.il/he/departments/topics/support-and-funding-for-public-institutions/govil-landing-page',
    funder: 'משרד האוצר',
  },
  // Additional Israeli sources
  {
    name: 'משרד הנגב והגליל — קולות קוראים',
    url: 'https://www.gov.il/he/departments/topics/negev-galil-programs/govil-landing-page',
    funder: 'משרד הנגב, הגליל והחוסן הלאומי',
  },
  {
    name: 'SocialMap — קולות קוראים',
    url: 'https://socialmap.org.il/hakol-kore',
    funder: '',
  },
  {
    name: 'גיידסטאר — קולות קוראים',
    url: 'https://www.guidestar.org.il/search-announcements',
    funder: '',
  },
  {
    name: 'שפ"י — שירות פסיכולוגי ייעוצי',
    url: 'https://shefi.education.gov.il/publication/voices-calling',
    funder: 'שפ"י — משרד החינוך',
  },
  {
    name: 'ג׳וינט — אלכא',
    url: 'https://www.jdc.org.il/program/elka/',
    funder: 'ג׳וינט ישראל',
  },
  {
    name: 'קרן אבי חי',
    url: 'https://avichai.org.il/%D7%9E%D7%A2%D7%A0%D7%A7%D7%99%D7%9D/',
    funder: 'קרן אבי חי',
  },
  {
    name: 'Hadassah Foundation',
    url: 'https://hadassahfoundation.org/apply/',
    funder: 'Hadassah Foundation',
  },
  {
    name: 'fundsforNGOs — Youth & Adolescents',
    url: 'https://www2.fundsforngos.org/category/youth-adolescents/',
    funder: '',
  },
  {
    name: 'fundsforNGOs — Education',
    url: 'https://www2.fundsforngos.org/category/education/',
    funder: '',
  },
  {
    name: 'fundsforNGOs — Latest Grants',
    url: 'https://www2.fundsforngos.org/category/latest-funds-for-ngos/',
    funder: '',
  },
  {
    name: 'משרד הרווחה — מכרזים ציבוריים',
    url: 'https://www.gov.il/he/departments/topics/ministry-of-welfare-tenders/govil-landing-page',
    funder: 'משרד הרווחה',
  },
  {
    name: 'רשות החדשנות — כל הקולות',
    url: 'https://innovationisrael.org.il/kol_kore/',
    funder: 'רשות החדשנות',
  },
  {
    name: 'Menomadin Foundation',
    url: 'https://www.menomadin.org/he/grants',
    funder: 'Menomadin Foundation',
  },
  {
    name: 'קרן מנדל — מלגות ותכניות',
    url: 'https://www.mandelfoundation.org.il/programs',
    funder: 'קרן מנדל',
  },
  {
    name: 'UJA Federation NY — Israel Grants',
    url: 'https://www.ujafedny.org/grants-and-scholarships/',
    funder: 'UJA Federation New York',
  },

  // ── next_dryrun — DryRun only, no DB write until QA approved ──
  // To promote to approved_pipeline: remove dryRun:true after reviewing DryRun report
  {
    name: 'משרד האוצר — תמיחות (tmichot)',
    url: 'https://tmichot.mof.gov.il/call-for-proposals',
    funder: 'משרד האוצר',
    dryRun: true,
  },
  {
    name: 'משרד החינוך — פורטל קולות קוראים (POB)',
    url: 'https://pob.education.gov.il/kolotkorim/kolkore',
    funder: 'משרד החינוך',
    dryRun: true,
  },
  {
    name: 'משרד הבריאות — קולות קוראים',
    url: 'https://www.gov.il/he/departments/topics/ministry-of-health-calls/govil-landing-page',
    funder: 'משרד הבריאות',
    dryRun: true,
  },
  {
    name: 'שוויון חברתי — קולות קוראים',
    url: 'https://www.gov.il/he/departments/topics/equality-programs/govil-landing-page',
    funder: 'משרד השוויון החברתי',
    dryRun: true,
  },

  // ── browser_required — JS-rendered, needs Playwright ──────
  // disabled:true = skipped entirely until Playwright is available
  {
    name: 'SocialMap — קולות קוראים',
    url: 'https://socialmap.org.il/hakol-kore',
    funder: '',
    disabled: true, // JS-rendered, returns empty HTML without browser
  },
];

// ============================================================
// PDF EXTRACTION — reads grant PDFs linked from grant pages
// ============================================================
const GRANT_PDF_KEYWORDS = /מכרז|קול.קורא|הנחי|תנאי|נוהל|הזמנה|בקשה|טופס|נספח|הוראות|פרטים|תקנון|כללים|requirements|guidelines|application|terms|call.for|grant/i;

async function extractPdfFromPage(pageUrl: string, html: string): Promise<string> {
  const pdfLinks: string[] = [];
  const linkPattern = /href=["']([^"']*\.pdf[^"']*)/gi;
  for (const match of html.matchAll(linkPattern)) {
    let pdfUrl = match[1];
    if (!pdfUrl.startsWith('http')) {
      try {
        const base = new URL(pageUrl);
        pdfUrl = pdfUrl.startsWith('/') ? `${base.origin}${pdfUrl}` : `${base.origin}/${pdfUrl}`;
      } catch { continue; }
    }
    if (GRANT_PDF_KEYWORDS.test(pdfUrl) && !pdfLinks.includes(pdfUrl)) {
      pdfLinks.push(pdfUrl);
    }
  }

  for (const pdfUrl of pdfLinks.slice(0, 1)) {
    try {
      const pdfRes = await fetch(pdfUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000),
      });
      if (!pdfRes.ok) continue;
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      if (buffer.length < 500 || buffer.length > 10_000_000) continue;
      const extracted = await geminiOcrPdf(buffer);
      if (extracted && extracted.length > 100) {
        return `\n\n--- מסמך PDF מצורף ---\n${extracted.slice(0, 4000)}`;
      }
    } catch { /* skip */ }
  }
  return '';
}

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

interface GrantClassification {
  categories: string[];
  target_populations: string[];
  regions: string[];
  also_relevant_for: string[];
  relevance_reasoning: string;
}

async function classifyGrantWithAI(
  title: string,
  description: string,
  pageText: string
): Promise<GrantClassification | null> {
  const text = `${title}\n${description}\n${pageText}`.slice(0, 4000);
  try {
    const res = await withRetry(
      () => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      system: `אתה יועץ גיוס משאבים מומחה שמסווג קולות קוראים. יש לך שני תפקידים:
1. סיווג ישיר — מה הקול הקורא מבקש במפורש
2. ראייה מעבר — אילו ארגונים נוספים יכולים להגיש גם אם הם לא בתחום הישיר

הקטגוריות (categories):
${VALID_CATEGORIES.join(', ')}

אוכלוסיות (target_populations):
${VALID_POPULATIONS.join(', ')}

אזורים (regions):
${VALID_REGIONS.join(', ')}

כללי "ראייה מעבר" — חשוב כמו יועץ גיוס משאבים:
- "חוסן קהילתי" = גם חינוך, נוער, בריאות נפש, תעסוקה, ספורט, תרבות
- "מניעת פשיעה" = גם נוער בסיכון, חינוך, תעסוקה, ליווי אישי
- "שוויון הזדמנויות" = גם נשים, ערבים, מוגבלויות, פריפריה, עולים
- "חירום ותקומה" = כמעט כל ארגון חברתי שפועל באזורי עימות
- "פיתוח הנגב/הגליל" = כל ארגון שיכול להוכיח פעילות באזור
- "חדשנות חברתית" = כל שיטת עבודה חדשה, לא רק טכנולוגיה
- קרנות ממשלתיות (משרד חינוך, רווחה, בריאות) = מחפשות שותפויות עם רשויות ומדידה
- קרנות פרטיות = מחפשות חדשנות, בידול, סיפור אישי
- קרנות בינלאומיות = רוצות Theory of Change, SDGs, SROI
- CSR = רוצות חשיפה, מעורבות עובדים, אימפקט מדיד

החזר JSON בלבד:
{
  "categories": [1-3 קטגוריות ישירות],
  "target_populations": [אוכלוסיות יעד מפורשות],
  "regions": [אזורים גאוגרפיים],
  "also_relevant_for": [קטגוריות ואוכלוסיות נוספות שיכולים להגיש — חשוב מעבר למילים],
  "relevance_reasoning": "הסבר קצר למה גם ארגונים אחרים רלוונטיים"
}`,
      messages: [{ role: 'user', content: text }],
      max_tokens: 400,
    }),
      4, 2000, 'classifyGrantWithAI',
    );

    const aiText = res.content[0].type === 'text' ? res.content[0].text : '{}';
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const allValidTags = [...VALID_CATEGORIES, ...VALID_POPULATIONS, ...VALID_REGIONS];
    return {
      categories: (parsed.categories || []).filter((k: string) => VALID_CATEGORIES.includes(k)),
      target_populations: (parsed.target_populations || []).filter((k: string) => VALID_POPULATIONS.includes(k)),
      regions: (parsed.regions || []).filter((k: string) => VALID_REGIONS.includes(k)),
      also_relevant_for: (parsed.also_relevant_for || []).filter((k: string) => allValidTags.includes(k)),
      relevance_reasoning: parsed.relevance_reasoning || '',
    };
  } catch {
    return null;
  }
}

// ============================================================
// TITLE VALIDATION — reject garbage
// ============================================================
// URL patterns that indicate a scanned link is an asset/nav-element, not a real grant
const JUNK_URL_PATTERNS = [
  /the-lottery-logo/i,
  /logo.*\.pdf/i,
  /favicon/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.gif$/i,
];

// Language-selector titles that get scraped accidentally from multilingual sites
const JUNK_TITLE_EXACT = new Set([
  'Nederlands (Dutch)', 'Español (Spanish)', 'English', 'Français (French)',
  'Deutsch (German)', 'Русский (Russian)', 'العربية (Arabic)', 'עברית (Hebrew)',
  'Italiano (Italian)', 'Português (Portuguese)',
]);

// Partial-match patterns — titles containing these strings are junk
const JUNK_TITLE_PATTERNS = [
  /להורדת מסמך/i,
  /לחץ כאן להורדה/i,
  /download.*pdf/i,
  /click here to download/i,
  /^\s*>\s*$/,   // just ">"
];

function isValidTitle(title: string): boolean {
  if (!title || title.length < 8 || title.length > 200) return false;
  if (JUNK_TITLE_EXACT.has(title)) return false;
  if (JUNK_TITLE_PATTERNS.some(re => re.test(title))) return false;
  const skip = ['קישור', 'תאריך אחרון', 'מפרסם', 'דף הבית', 'צור קשר', 'אודות', 'חיפוש', 'הרשמה', 'menu', 'search', 'home'];
  const lower = title.toLowerCase();
  return !skip.some(s => lower.includes(s) || title.includes(s));
}

function isValidGrantUrl(url: string | undefined): boolean {
  if (!url) return true; // no URL is fine — title may still be valid
  return !JUNK_URL_PATTERNS.some(re => re.test(url));
}

// ============================================================
// LINK QUALITY INFERENCE — assigns standard link_quality value
// ============================================================
function inferLinkQuality(url: string | undefined, applicationUrl: string | undefined): string {
  // ── Step 1: classify by applicationUrl if present ──────────────────────────
  if (applicationUrl) {
    // PDF attachment → official_pdf
    if (/\.pdf(\?.*)?$/i.test(applicationUrl)) return 'official_pdf';

    // Explicit web forms / submission portals → direct_application
    const DIRECT_APP_PATTERNS = [
      /forms\.gle\//i,
      /docs\.google\.com\/forms\//i,
      /my\.pais\.co\.il/i,
      /manofexpo\.kkl\.org\.il/i,
      /typeform\.com/i,
      /jotform\.com/i,
      /surveymonkey\.com/i,
      /monday\.com\/forms\//i,
      /airtable\.com\/shr/i,
      /pops\.expertisefrance\.fr/i,
      /[?&/](apply|submit|application|register|hagasha|hagashot)[/?&]/i,
      /\/(apply|submit|application|register)\/?$/i,
    ];
    if (DIRECT_APP_PATTERNS.some(re => re.test(applicationUrl))) return 'direct_application';

    // Broad info portals — not a direct form even if set as application_url
    const AGGREGATOR_APP_PATTERNS = [
      /ec\.europa\.eu/i,
      /eismea\.ec\.europa\.eu/i,
      /funding-tenders\.ec\.europa\.eu/i,
      /jewishagency\.org/i,
      /nif\.org/i,
      /jdc\.org/i,
      /shatil\.org\.il/i,
      /guidestar\.org\.il/i,
      /socialmap\.org\.il/i,
    ];
    if (AGGREGATOR_APP_PATTERNS.some(re => re.test(applicationUrl))) return 'official_info_page';

    // Gov portals in applicationUrl → gov_blocked
    if (/gov\.il|mr\.gov\.il|pob\.education\.gov\.il|btl\.gov\.il|govextra\.gov\.il/i.test(applicationUrl))
      return 'gov_blocked';

    // Conservative fallback: specific path = info page (not assumed direct)
    const appPath = applicationUrl.replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '');
    if (appPath.split('/').filter(Boolean).length >= 2) return 'official_info_page';
  }

  // ── Step 2: classify by page url ───────────────────────────────────────────
  if (!url) return 'official_info_page';

  // Government portals
  if (/gov\.il|mr\.gov\.il|pob\.education\.gov\.il|btl\.gov\.il|govextra\.gov\.il/i.test(url))
    return 'gov_blocked';

  // Aggregators
  if (/shatil\.org\.il|socialmap\.org\.il|jdc\.org\.il\/calls|guidestar\.org\.il|fundsforngos|grantwatch\.com|ujafedny\.org\/grants/i.test(url))
    return 'aggregator_no_direct_apply';

  // Foundation grant-list pages (broad, no single-call form)
  if (/jewishagency\.org|nif\.org|britpicot\.org\.il|rashy\.org\.il|jerusalemfoundation\.org/i.test(url))
    return 'aggregator_no_direct_apply';

  // PDF direct link
  if (/\.pdf(\?.*)?$/i.test(url)) return 'official_pdf';

  return 'official_info_page';
}

/*
 * inferLinkQuality — test cases:
 *   shatil.org.il/kol/X  + forms.gle/abc123          → direct_application       ✓
 *   shatil.org.il/kol/X  + ec.europa.eu/portal/...   → official_info_page        ✓
 *   pob.education.gov.il + null                       → gov_blocked               ✓
 *   mr.gov.il/...        + null                       → gov_blocked               ✓
 *   kkl.org.il/tenders/X + manofexpo.kkl.org.il/...  → direct_application        ✓
 *   drive.google.com/.../view (PDF)                   → official_pdf (via url)    ✓
 *   rothschildfoundation.eu/grants-page/              → official_info_page        ✓
 *   jewishagency.org/grants/                          → aggregator_no_direct_apply ✓
 */

// ============================================================
// OPPORTUNITY REJECTION — items that must never be active=true
// ============================================================
const REJECT_TITLE_PATTERNS = [
  /ההגשה הסתיימה/,
  /תובענה/,         // class-action templates from ezvonot
  /glossary/i,
  /terms of service/i,
  /privacy policy/i,
  /הצטרפו למנוי/,
  /מדריך לניהול/,
  /nonprofit glossary/i,
  /candid near you/i,
  /artificial intelligence notice/i,
  /^packshot/i,
];

const REJECT_URL_PATTERNS = [
  /\/archive\//i,
  /mailto:/i,
  /\.mp4(\?|$)/i,
  /\.mov(\?|$)/i,
  /\.png(\?|$)/i,
  /\.jpg(\?|$)/i,
  /\.gif(\?|$)/i,
  /\.svg(\?|$)/i,
  /ezvonot\.com/i,      // class-action site, not grants
  /missfixtheuniverse/i,
  /candid\.org\/resources/i,
  /candid\.org\/terms/i,
  /candid\.org\/artificial/i,
  /subscriber\/register/i,
  /\/grantsfolder\//i,  // pais historical archive
  // shatil non-grant pages
  /shatil\.org\.il\/consultation/i,
  /shatil\.org\.il\/projects-category/i,
  /shatil\.org\.il\/tools/i,
  /shatil\.org\.il\/news/i,
  /shatil\.org\.il\/bio/i,
  /shatil\.org\.il\/?$/i,  // shatil homepage
  // generic terms/glossary/news
  /\/terms\//i,
  /\/glossary\//i,
  /\/news\b/i,
];

// Generic list/category pages — not a specific grant opportunity
const GENERIC_URL_PATTERNS = [
  /\/kolotkorim\/?$/i,
  /\/kolotkorim\/pages/i,
  /\/grants\/?$/i,
  /\/apply\/?$/i,
  /\/grants-and-scholarships\/?$/i,
  /\/calls-for-proposals\/?$/i,
  /\/קרנות-וקולות-קוראים\/?$/i,
  /\/מענקים\/?$/i,
  /\/tenders\/?$/i,
  /\/programs\/?$/i,
];

function shouldRejectOpportunity(item: ScannedItem, sourceUrl: string): boolean {
  const title = item.title || '';
  const url = item.url || '';

  // Reject by title pattern
  if (REJECT_TITLE_PATTERNS.some(re => re.test(title))) return true;

  // Reject by URL pattern
  if (REJECT_URL_PATTERNS.some(re => re.test(url))) return true;

  // Reject pure homepage (no meaningful path)
  if (url) {
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '');
    if (path === '' || path === '/') return true;
  }

  // Reject generic list/category pages
  if (GENERIC_URL_PATTERNS.some(re => re.test(url))) return true;

  // Reject if URL equals the source URL exactly (would re-insert source entry itself)
  if (url && sourceUrl && url.replace(/\/+$/, '') === sourceUrl.replace(/\/+$/, '')) return true;

  return false;
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
        // Reject generic URLs — must have a specific path (at least 2 segments)
        if (url) {
          const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '');
          if (path.split('/').filter(Boolean).length < 2) url = '';
        }

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

const BATCH_SIZE = 5; // sources per batch (Vercel Hobby = 10s timeout)

async function scanAllSources(batchIndex?: number, overrideSources?: Source[]) {
  const supabase = createAdminClient();
  let totalNew = 0;
  let totalSkipped = 0;
  let deactivated = 0;
  const errors: string[] = [];

  // Determine which sources to scan — skip disabled sources entirely
  const activeSources = SOURCES.filter(s => !s.disabled);
  const sourcesToScan = overrideSources
    ? overrideSources
    : batchIndex !== undefined
      ? activeSources.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE)
      : activeSources;
  const isFirstBatch = !overrideSources && (batchIndex === undefined || batchIndex === 0);
  const dryRunSources = new Set(sourcesToScan.filter(s => s.dryRun).map(s => s.name));
  const dryRunResults: { source: string; found: number; would_insert: number; samples: string[] }[] = [];

  // === Step 1: Cleanup expired & stale (only on first batch) ===
  const today = new Date().toISOString().split('T')[0];
  const currentYear = new Date().getFullYear();

  if (isFirstBatch) {
    // 1a. Deadline passed
    const { data: expired } = await supabase
      .from('opportunities')
      .update({ active: false })
      .lt('deadline', today)
      .eq('active', true)
      .not('deadline', 'is', null)
      .select('id');
    deactivated = expired?.length || 0;

    // 1b. No deadline + older than 90 days = stale
    const staleDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: stale } = await supabase
      .from('opportunities')
      .update({ active: false })
      .eq('active', true)
      .is('deadline', null)
      .lt('scraped_at', staleDate)
      .select('id');
    deactivated += stale?.length || 0;

    // 1c. Old years in title (2 years ago or more)
    const oldYears = Array.from({ length: 5 }, (_, i) => String(currentYear - 2 - i));
    const lastYear = String(currentYear - 1);
    for (const year of [lastYear, ...oldYears]) {
      const { data: old } = await supabase
        .from('opportunities')
        .update({ active: false })
        .eq('active', true)
        .ilike('title', `%${year}%`)
        .not('title', 'ilike', `%${year}-${String(Number(year) + 1).slice(2)}%`)
        .select('id');
      deactivated += old?.length || 0;
    }

    // 1d. title = funder (fund profiles, not actual grants)
    const { data: fundProfiles } = await supabase
      .from('opportunities')
      .select('id, title, funder')
      .eq('active', true);
    if (fundProfiles) {
      const toDeactivate = fundProfiles.filter(o =>
        o.title === o.funder ||
        (o.title && o.title.toLowerCase().startsWith('funding in '))
      ).map(o => o.id);
      if (toDeactivate.length > 0) {
        await supabase.from('opportunities').update({ active: false }).in('id', toDeactivate);
        deactivated += toDeactivate.length;
      }
    }
  }

  // === Step 2: Get existing titles for dedup ===
  const { data: existingData } = await supabase
    .from('opportunities')
    .select('title, url')
    .limit(2000);
  const existingTitles = new Set((existingData || []).map(e => e.title?.slice(0, 40)).filter(Boolean));
  const existingUrls = new Set((existingData || []).map(e => e.url).filter(Boolean));

  // === Step 3: Scan sources (batch or all) ===
  for (const source of sourcesToScan) {
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
        if (!isValidGrantUrl(item.url)) continue;

        // Check if item should be rejected — save as active=false with reject reason
        const rejected = shouldRejectOpportunity(item, source.url);
        if (rejected) {
          // Only persist rejections that have a URL (so we can dedup future scans)
          if (item.url && !existingUrls.has(item.url) && !dryRunSources.has(source.name)) {
            const rejectReason = /\/archive\/|grantsfolder/i.test(item.url || '') ? 'archived'
              : /ההגשה הסתיימה/.test(item.title) ? 'submission_closed'
              : /homepage|category|list/.test('') || GENERIC_URL_PATTERNS.some(re => re.test(item.url || '')) ? 'generic_list_page'
              : 'not_opportunity';
            await supabase.from('opportunities').insert({
              title: item.title.slice(0, 300),
              funder: item.funder || source.funder || null,
              url: item.url,
              active: false,
              source: source.name,
              type: 'grant',
              requirements: { link_quality: 'not_opportunity', reject_reason: rejectReason },
            }).select('id').single();
            existingUrls.add(item.url);
          }
          totalSkipped++;
          continue;
        }

        // Set funder from source if AI didn't extract one
        if (!item.funder && source.funder) {
          item.funder = source.funder;
        }

        // Skip irrelevant: international grants not related to Israel/Jewish
        if (item.url?.includes('fundsforngos.org')) {
          const combined = `${item.title} ${item.description || ''}`.toLowerCase();
          if (!combined.includes('israel') && !combined.includes('jewish') && !combined.includes('hebrew')) {
            totalSkipped++;
            continue;
          }
        }

        // Skip fund profiles (title = funder name, no actual grant)
        if (item.title === item.funder || item.title.toLowerCase().startsWith('funding in ')) {
          totalSkipped++;
          continue;
        }

        // Skip personal benefit grants (not for NGOs) — e.g. maternity grant, death grant
        const PERSONAL_GRANT_SKIP = /מענק לידה|מענק פטירה|מענק בעבודה נדרשת|מענק לימודים|תמיכה טכנית|גיוס עובדים|פרסומים בתמיכת|successfully completed|cohort.*completed/i;
        if (PERSONAL_GRANT_SKIP.test(item.title)) {
          totalSkipped++;
          continue;
        }

        // Skip personal-benefit URLs (btl benefits, jobs pages)
        if (item.url && /\/(benefits|jobs|Publications|BakashotNetunim|snifim|TroubleShooting)\//i.test(item.url)) {
          item.url = undefined;
        }

        // Skip old years in title
        const titleLower = item.title.toLowerCase();
        const oldYearInTitle = Array.from({ length: 5 }, (_, i) => String(currentYear - 1 - i))
          .some(y => titleLower.includes(y) && !titleLower.includes(`${y}-${String(Number(y) + 1).slice(2)}`));
        if (oldYearInTitle) {
          totalSkipped++;
          continue;
        }

        // Strip invalid URLs — only specific grant pages are valid
        if (item.url) {
          const stripped = item.url.replace(/\/+$/, '');
          const path = stripped.replace(/^https?:\/\/[^/]+/, '');
          const isHomepage = /^https?:\/\/[^/]+\/?$/.test(item.url) || path.split('/').filter(Boolean).length < 2;
          const isSourceUrl = source.url && stripped === source.url.replace(/\/+$/, '');
          // File downloads and generic list pages are not valid grant URLs
          const isFileDownload = /\.(docx?|xlsx?|zip|pptx?)$/i.test(item.url);
          const isListPage = /\/(category|tag|search|tenders\/?$|grants\/?$|calls\/?$|kolotkorim\/pages)/i.test(path);
          if (isHomepage || isSourceUrl || isFileDownload || isListPage) {
            item.url = undefined;
          }

          // KKL guard: only allow URLs under /about-us/tenders/ or manofexpo.kkl.org.il
          // Prevents full-site crawl that produced 113 non-grant pages previously
          if (item.url && source.name === 'קק"ל') {
            const isKklTendersPath = item.url.includes('/about-us/tenders/');
            const isKklManof = item.url.includes('manofexpo.kkl.org.il');
            if (!isKklTendersPath && !isKklManof) {
              item.url = undefined;
            }
          }
        }

        // Require URL — no URL = cannot link to grant
        if (!item.url) {
          totalSkipped++;
          continue;
        }

        // Dedup: check URL (only specific URLs, not homepages) and title prefix
        const isGenericUrl = false; // already filtered above
        if (item.url && existingUrls.has(item.url)) {
          totalSkipped++;
          continue;
        }
        const titlePrefix = item.title.slice(0, 40);
        if (existingTitles.has(titlePrefix)) {
          totalSkipped++;
          continue;
        }

        // Fetch grant page — extract contact info + full content + PDF
        let contactInfo: string | null = null;
        let pageText = '';
        let fullContent: string | null = null;
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
              // Save meaningful content (>200 chars) + any attached PDF
              if (pageText.trim().length > 200) {
                const pdfText = await extractPdfFromPage(item.url, pageHtml);
                fullContent = (pageText.trim().slice(0, 8000) + pdfText).slice(0, 8000);
              }
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
        const alsoRelevantFor = aiTags?.also_relevant_for || [];

        // Lookup funder_id from funder_intelligence (cross-tab link)
        let funderId: string | null = null;
        let funderAppUrl: string | null = null;
        let funderSubmissionMethod: string | null = null;
        if (item.funder) {
          const { data: fi } = await supabase
            .from('funder_intelligence')
            .select('id, application_url, submission_method')
            .ilike('funder_name', `%${item.funder}%`)
            .limit(1)
            .single();
          if (fi) {
            funderId = fi.id;
            funderAppUrl = fi.application_url || null;
            funderSubmissionMethod = fi.submission_method || null;
          }
        }

        // DryRun mode: log what would be inserted, but don't write to DB
        if (dryRunSources.has(source.name)) {
          let drEntry = dryRunResults.find(d => d.source === source.name);
          if (!drEntry) {
            drEntry = { source: source.name, found: 0, would_insert: 0, samples: [] };
            dryRunResults.push(drEntry);
          }
          drEntry.found++;
          drEntry.would_insert++;
          if (drEntry.samples.length < 10) {
            drEntry.samples.push(`${item.title.slice(0, 80)} | ${item.url?.slice(0, 60) || 'no-url'}`);
          }
          continue; // skip actual insert
        }

        const linkQuality = inferLinkQuality(item.url, funderAppUrl || undefined);

        const { data: inserted, error: insertErr } = await supabase.from('opportunities').insert({
          title: item.title.slice(0, 300),
          description: item.description?.slice(0, 1000) || null,
          funder: item.funder || null,
          funder_id: funderId,
          deadline: item.deadline || null,
          url: item.url || null,
          application_url: funderAppUrl,
          categories: finalCategories,
          target_populations: finalPopulations,
          regions: finalRegions,
          also_relevant_for: alsoRelevantFor,
          active: true,
          source: source.name,
          type: 'grant',
          contact_info: contactInfo,
          full_content: fullContent,
          how_to_apply: funderSubmissionMethod ? `שיטת הגשה: ${funderSubmissionMethod}` : null,
          requirements: { link_quality: linkQuality },
        }).select('id').single();

        if (!insertErr && inserted) {
          totalNew++;
          existingTitles.add(titlePrefix);
          if (item.url) existingUrls.add(item.url);

          // If funder_intelligence exists — auto-create funder_intelligence entry for new funder
          if (!funderId && item.funder) {
            await supabase.from('funder_intelligence').upsert({
              funder_name: item.funder,
              funder_style: 'foundation',
              preferred_domains: finalCategories,
              preferred_populations: finalPopulations,
              preferred_regions: finalRegions,
              recurring_months: [],
              total_submissions: 0,
              total_approved: 0,
              total_rejected: 0,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'funder_name' });

            // Link the new opportunity to the funder_intelligence record
            const { data: newFi } = await supabase
              .from('funder_intelligence')
              .select('id')
              .eq('funder_name', item.funder)
              .single();
            if (newFi) {
              await supabase.from('opportunities').update({ funder_id: newFi.id }).eq('id', inserted.id);
            }
          }
        } else if (insertErr) {
          // noop — skip duplicate
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
      sources_scanned: sourcesToScan.length,
    });
  } catch { /* table might not exist */ }

  return {
    batch: batchIndex !== undefined ? batchIndex : 'all',
    scanned: sourcesToScan.length,
    new_opportunities: totalNew,
    skipped: totalSkipped,
    deactivated_expired: deactivated,
    errors,
    dry_run_report: dryRunResults.length > 0 ? dryRunResults : undefined,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================
// AI EXTRACTION — Haiku extracts grants from HTML
// ============================================================
async function extractOpportunities(html: string, sourceName: string, sourceUrl: string): Promise<ScannedItem[]> {
  const res = await withRetry(
    () => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      system: `אתה מחלץ קולות קוראים ומענקים מדפי HTML.
חוקים קריטיים:
1. חלץ רק קולות קוראים/מענקים/תמיכות פתוחים — לא פרופילים של קרנות, לא דפי מידע כלליים.
2. אם הכותרת היא רק שם קרן (כמו "קרן הדסה") בלי פרטי קול קורא — דלג.
3. URL חייב להיות ישיר לדף הקול הקורא הספציפי — לא לדף הבית של הקרן/הממשלה.
   - gov.il/he/pages/XXXX ✓ | gov.il ✗
   - shatil.org.il/kol/XXXX ✓ | shatil.org.il ✗
   - innovationisrael.org.il/kol_kore/XXXX ✓ | innovationisrael.org.il/kalpiot ✗
   - אם אין URL ספציפי — שים null (עדיף null מ-URL גנרי)
4. חלץ את שם הגוף המממן (funder) — לא את שם הקול קורא.

החזר JSON בלבד — מערך של אובייקטים:
{
  "title": "שם הקול קורא המלא",
  "description": "תיאור קצר (עד 200 תווים)",
  "funder": "שם הגוף המממן",
  "deadline": "YYYY-MM-DD או null",
  "url": "לינק ישיר לדף הקול הקורא הספציפי, או null"
}

אם אין קולות קוראים בדף — החזר מערך ריק [].
לא להמציא. רק מה שרואים בטקסט.`,
      messages: [{
        role: 'user',
        content: `מקור: ${sourceName}\nURL: ${sourceUrl}\n\n${html}`,
      }],
      max_tokens: 4000,
    }),
    4, 2000, `extractOpportunities[${sourceName}]`,
  );

  const text = res.content[0].type === 'text' ? res.content[0].text : '[]';
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];

  try {
    return JSON.parse(jsonMatch[1]!.trim());
  } catch {
    return [];
  }
}
