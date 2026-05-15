// Org DNA — Smart classification of any organization based on profile + documents
// Used for matching against grants, companies, and opportunities

import { MODELS } from '@/lib/ai/prompts';

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.dna}`;

export interface OrgDNA {
  // Who the org serves (specific populations)
  populations: string[];
  // What domain/field they work in
  domains: string[];
  // Sub-domains (more specific than domains)
  subDomains: string[];
  // How the org intervenes (what it actually does)
  interventionTypes: string[];
  // Geographic focus
  geography: string[];
  // Age groups served
  ageGroups: string[];
  // Organization type/size
  orgType: 'small' | 'medium' | 'large';
  // Key themes (extracted from mission + docs)
  themes: string[];
  // Anti-match: populations/domains the org does NOT serve
  excludePopulations: string[];
  excludeDomains: string[];
  // Primary vs secondary — core mission gets 2x weight in matching
  primaryDomains?: string[];
  primaryPopulations?: string[];
  // Profile completeness (0-100) — affects match confidence
  profileCompleteness?: number;
}

// ===== Population Detection =====

const POPULATION_PATTERNS: { key: string; label: string; patterns: RegExp }[] = [
  { key: 'youth_at_risk', label: 'נוער בסיכון', patterns: /נוער.{0,5}סיכון|צעירים.{0,5}סיכון|נשירה|נושרים|מנותקים/ },
  { key: 'youth', label: 'נוער', patterns: /נוער|בני נוער|נערים|נערות|תיכון/ },
  { key: 'young_adults', label: 'צעירים', patterns: /צעירים|בוגרים צעירים|גיל 18|גיל 26|צעירי|דור צעיר/ },
  { key: 'children', label: 'ילדים', patterns: /ילדים|ילדות|גן|יסודי|גיל הרך/ },
  { key: 'disabilities', label: 'אנשים עם מוגבלות', patterns: /מוגבלות|מוגבלויות|נכות|נכים|שיקום|אוטיזם|אוטיסט|התפתחותי|מיוחד/ },
  { key: 'elderly', label: 'קשישים', patterns: /קשישים|זקנים|גיל הזהב|גיל שלישי|סיעודי/ },
  { key: 'immigrants', label: 'עולים', patterns: /עולים|עלייה|קליטה|יוצאי אתיופיה|אתיופים/ },
  { key: 'arab', label: 'חברה ערבית', patterns: /ערבי|ערבים|בדואי|בדואים|דרוזי|מגזר ערבי|חברה ערבית/ },
  { key: 'haredi', label: 'חרדים', patterns: /חרדי|חרדים|חרדית|אולטרא.?אורתודוקס/ },
  { key: 'women', label: 'נשים', patterns: /נשים|בנות|מגדר|פמיניז|אלמנות|חד הורי/ },
  { key: 'soldiers', label: 'חיילים/משוחררים', patterns: /חיילים|משוחררים|צבא|צה"ל|שירות.{0,5}(לאומי|צבאי)|גיוס/ },
  { key: 'homeless', label: 'חסרי בית', patterns: /חסרי בית|דרי רחוב|מחוסרי דיור/ },
  { key: 'addiction', label: 'התמכרויות', patterns: /התמכרות|סמים|אלכוהול|גמילה/ },
  { key: 'lgbtq', label: 'להט"ב', patterns: /להט"?ב|גאווה|טרנס|הומו|לסבי/ },
  { key: 'refugees', label: 'פליטים/מבקשי מקלט', patterns: /פליטים|מבקשי מקלט|מהגרים/ },
  { key: 'prisoners', label: 'אסירים/משוחררים', patterns: /אסירים|כלואים|משוחררי כלא|שב"ס/ },
  { key: 'general', label: 'אוכלוסייה כללית', patterns: /אוכלוסייה כללית|כלל הציבור|חברה ישראלית/ },
];

// ===== Domain Detection =====

const DOMAIN_PATTERNS: { key: string; label: string; patterns: RegExp }[] = [
  { key: 'education', label: 'חינוך', patterns: /חינוך|לימוד|הוראה|בית ספר|אקדמי|השכלה|מלגות|בגרות/ },
  { key: 'dropout_prevention', label: 'מניעת נשירה', patterns: /נשירה|מניעת נשירה|נושרים|מנותקים|שימור/ },
  { key: 'welfare', label: 'רווחה', patterns: /רווחה|סיוע|ליווי|העצמה|חוסן|שיקום חברתי/ },
  { key: 'employment', label: 'תעסוקה', patterns: /תעסוקה|עבודה|הכשרה מקצועית|קריירה|יזמות|הכנסה/ },
  { key: 'health', label: 'בריאות', patterns: /בריאות|רפואה|נפשי|טיפול|פסיכולוג|רפואי|קליני/ },
  { key: 'mental_health', label: 'בריאות הנפש', patterns: /בריאות הנפש|נפשי|פסיכולוג|חרדה|דיכאון|טראומה/ },
  { key: 'culture', label: 'תרבות ואמנות', patterns: /תרבות|אמנות|מוזיקה|תיאטרון|קולנוע|ספרות|יצירה/ },
  { key: 'environment', label: 'סביבה', patterns: /סביבה|אקולוגי|ירוק|קיימות|מיחזור|אקלים/ },
  { key: 'technology', label: 'טכנולוגיה', patterns: /טכנולוגי|דיגיטל|הייטק|תוכנה|מחשב|סייבר|AI/ },
  { key: 'agriculture', label: 'חקלאות', patterns: /חקלאות|חקלאי|גידול|משק|יער/ },
  { key: 'coexistence', label: 'דו-קיום', patterns: /דו.?קיום|שותפות|ערבים.{0,5}יהודים|חברה משותפת/ },
  { key: 'housing', label: 'דיור', patterns: /דיור|שכירות|מגורים|בינוי|נדל"ן|שיכון/ },
  { key: 'sport', label: 'ספורט', patterns: /ספורט|כדורגל|כדורסל|פעילות גופנית|אתלטיקה/ },
  { key: 'community', label: 'קהילה וחברה', patterns: /קהילה|קהילתי|שכונה|מתנ"ס|מרכז קהילתי|חברתי|חברתית|שינוי חברתי/ },
  { key: 'social_innovation', label: 'חדשנות חברתית', patterns: /חדשנות חברתית|שינוי חברתי|מוביליות חברתית|אימפקט|impact|social.?innovation|social.?tech/ },
  { key: 'legal', label: 'משפטי', patterns: /משפטי|זכויות|ייצוג|פרקליט|סיוע משפטי/ },
  { key: 'science', label: 'מדע ומחקר', patterns: /מדע(?!.{0,5}(חברתי|קדמה))|מחקר מדעי|מעבדה|פטנט/ },
  { key: 'religion', label: 'דת', patterns: /דת|דתי|יהדות|תורה|בית כנסת|רבנות/ },
  { key: 'infrastructure', label: 'תשתיות', patterns: /תשתית|בינוי|שיפוץ|הקמה|מבנה/ },
];

// ===== Sub-Domain Detection (more specific than domains) =====

const SUB_DOMAIN_PATTERNS: { key: string; label: string; parentDomain: string; patterns: RegExp }[] = [
  // חינוך — תת-קטגוריות
  { key: 'dropout_prevention', label: 'מניעת נשירה', parentDomain: 'education', patterns: /נשירה|מניעת נשירה|נושרים|מנותקים|שימור תלמידים/ },
  { key: 'scholarships', label: 'מלגות', parentDomain: 'education', patterns: /מלגות|מלגה|תמיכה כלכלית.{0,10}לימוד/ },
  { key: 'special_education', label: 'חינוך מיוחד', parentDomain: 'education', patterns: /חינוך מיוחד|לקויות למידה|ליקויי למידה|דיסלקסיה|הפרעות קשב/ },
  { key: 'informal_education', label: 'חינוך בלתי פורמלי', parentDomain: 'education', patterns: /חינוך בלתי פורמלי|פעילות חוץ.?בית.?ספרית|תנועת נוער|מחנות קיץ/ },
  { key: 'higher_education', label: 'השכלה גבוהה', parentDomain: 'education', patterns: /אקדמי|אוניברסיטה|מכללה|תואר|סטודנט/ },
  { key: 'early_childhood', label: 'גיל הרך', parentDomain: 'education', patterns: /גיל הרך|גני ילדים|פעוטון|משפחתון/ },
  { key: 'bagrut', label: 'בגרות', parentDomain: 'education', patterns: /בגרות|בחינות בגרות|תעודת בגרות/ },

  // בריאות — תת-קטגוריות
  { key: 'mental_health_services', label: 'שירותי בריאות הנפש', parentDomain: 'health', patterns: /בריאות הנפש|קליניקה נפשית|פסיכותרפיה|טיפול פסיכולוגי|מרפאה נפשית/ },
  { key: 'rehabilitation', label: 'שיקום', parentDomain: 'health', patterns: /שיקום|שיקומי|החלמה|פוסט.?טראומה/ },
  { key: 'preventive_health', label: 'בריאות מונעת', parentDomain: 'health', patterns: /בריאות מונעת|מניעה|סקירה רפואית|הסברה בריאותית/ },
  { key: 'addiction_treatment', label: 'טיפול בהתמכרויות', parentDomain: 'health', patterns: /גמילה|טיפול.{0,10}התמכרות|שיקום.{0,10}סמים|קהילה טיפולית/ },
  { key: 'maternal_child_health', label: 'בריאות האם והילד', parentDomain: 'health', patterns: /בריאות האם|טרום לידה|לידה|יולדות|תינוקות/ },

  // תעסוקה — תת-קטגוריות
  { key: 'vocational_training', label: 'הכשרה מקצועית', parentDomain: 'employment', patterns: /הכשרה מקצועית|הסמכה מקצועית|קורס מקצועי|מיומנויות תעסוקה/ },
  { key: 'job_placement', label: 'השמה בעבודה', parentDomain: 'employment', patterns: /השמה|מציאת עבודה|חיפוש עבודה|גיוס עובדים/ },
  { key: 'entrepreneurship_support', label: 'יזמות', parentDomain: 'employment', patterns: /יזמות|סטארט.?אפ|עסק קטן|הקמת עסק|אינקובטור/ },
  { key: 'financial_literacy', label: 'אוריינות פיננסית', parentDomain: 'employment', patterns: /אוריינות פיננסית|ניהול כלכלי|חסכון|חובות|פשיטת רגל/ },

  // רווחה — תת-קטגוריות
  { key: 'emergency_aid', label: 'סיוע חירום', parentDomain: 'welfare', patterns: /סיוע חירום|מזון חירום|מקלט|חירום/ },
  { key: 'food_security', label: 'ביטחון תזונתי', parentDomain: 'welfare', patterns: /מזון|מזנון|חבילות מזון|ביטחון תזונתי|רעב|תזונה/ },
  { key: 'housing_support', label: 'סיוע בדיור', parentDomain: 'welfare', patterns: /דיור מעבר|דיור תומך|מסגרת מגורים|הוסטל/ },
  { key: 'family_support', label: 'תמיכה משפחתית', parentDomain: 'welfare', patterns: /תמיכה משפחתית|הורות|ייעוץ משפחתי|אלימות במשפחה/ },
  { key: 'rights_realization', label: 'מיצוי זכויות', parentDomain: 'welfare', patterns: /מיצוי זכויות|זכויות סוציאליות|קצבאות|ביטוח לאומי/ },

  // קהילה — תת-קטגוריות
  { key: 'youth_centers', label: 'מרכזי נוער', parentDomain: 'community', patterns: /מרכז נוער|מרכזי נוער|מועדון נוער|מרכז קהילתי לנוער/ },
  { key: 'volunteering', label: 'התנדבות', parentDomain: 'community', patterns: /התנדבות|מתנדבים|שירות קהילתי|פרויקט חברתי/ },
  { key: 'leadership', label: 'פיתוח מנהיגות', parentDomain: 'community', patterns: /מנהיגות|פיתוח מנהיגות|מנהיגים צעירים|תכנית מנהיגות/ },
];

// ===== Intervention Type Detection (what the org actually does) =====

const INTERVENTION_PATTERNS: { key: string; label: string; patterns: RegExp }[] = [
  { key: 'personal_mentoring', label: 'ליווי אישי / מנטורינג', patterns: /ליווי אישי|מנטור|חונכות|חונך|אחד על אחד|one.?on.?one/ },
  { key: 'group_workshops', label: 'סדנאות קבוצתיות', patterns: /סדנאות|סדנה|קבוצות|קבוצת תמיכה|מפגשים קבוצתיים/ },
  { key: 'financial_grants', label: 'מענקים כספיים ישירים', patterns: /מענקים? ישיר|סיוע כספי|תמיכה כלכלית|תשלום ישיר|קרן סיוע/ },
  { key: 'scholarships_grants', label: 'מלגות ללומדים', patterns: /מלגות|מלגה|תמיכה בלימודים|נסיעות|מחייה/ },
  { key: 'hotline_support', label: 'קו סיוע / ייעוץ מרחוק', patterns: /קו חם|קו סיוע|טלפון סיוע|ייעוץ טלפוני|צ׳אט תמיכה/ },
  { key: 'residential_program', label: 'תכנית פנימייתית', patterns: /פנימייה|מסגרת פנימייתית|דיור תומך|בית חם|מסגרת לינה/ },
  { key: 'day_program', label: 'תכנית יומית', patterns: /מסגרת יומית|יום טיפולי|מרכז יום|פעילות יומית/ },
  { key: 'advocacy_policy', label: 'הסברה ומדיניות', patterns: /הסברה|שינוי מדיניות|לובי|דוגלים|עמדה ציבורית|קמפיין חברתי/ },
  { key: 'research', label: 'מחקר והערכה', patterns: /מחקר|הערכת תכניות|אקדמי|מחקרי|ניתוח נתונים|דוח מחקר/ },
  { key: 'training_professionals', label: 'הכשרת אנשי מקצוע', patterns: /הכשרת אנשי מקצוע|הדרכת עובדים|הכשרת מורים|הכשרת מטפלים|פיתוח מקצועי/ },
  { key: 'tech_platform', label: 'פלטפורמה טכנולוגית', patterns: /אפליקציה|פלטפורמה דיגיטלית|מערכת ממוחשבת|כלי דיגיטלי|תוכנה/ },
  { key: 'cultural_activities', label: 'פעילות תרבותית / אמנותית', patterns: /תיאטרון|מוזיקה|אמנות|קולנוע|ריקוד|קרקס|יצירה/ },
  { key: 'sports_activities', label: 'פעילות ספורטיבית', patterns: /ספורט|כדורגל|כדורסל|שחייה|אתלטיקה|פעילות גופנית/ },
  { key: 'legal_aid', label: 'ייעוץ משפטי', patterns: /ייעוץ משפטי|ייצוג משפטי|עורך דין|קליניקה משפטית|סיוע משפטי/ },
  { key: 'employment_placement', label: 'השמה בעבודה', patterns: /השמה|מציאת עבודה|גיוס לעבודה|שוק העבודה/ },
];

// ===== Geography Detection =====

const GEO_PATTERNS: { key: string; label: string; patterns: RegExp }[] = [
  { key: 'negev', label: 'נגב', patterns: /נגב|באר שבע|ערד|דימונה|רהט|ירוחם|מצפה רמון|שגב.?שלום/ },
  { key: 'galilee', label: 'גליל', patterns: /גליל|צפת|כרמיאל|עכו|נהריה|מעלות|קריית שמונה/ },
  { key: 'periphery', label: 'פריפריה', patterns: /פריפריה|שולי|מרוחק|עוטף|קו עימות|גבול/ },
  { key: 'center', label: 'מרכז', patterns: /מרכז|תל אביב|גוש דן|רמת גן|פתח תקווה|חולון|בת ים/ },
  { key: 'jerusalem', label: 'ירושלים', patterns: /ירושלים/ },
  { key: 'haifa', label: 'חיפה', patterns: /חיפה|קריות/ },
  { key: 'national', label: 'ארצי', patterns: /ארצי|ברחבי הארץ|כלל ארצי|פריסה ארצית/ },
  { key: 'international', label: 'בינלאומי', patterns: /בינלאומי|חו"ל|אירופ|אמריק|גלובל/ },
];

// ===== Age Group Detection =====

const AGE_PATTERNS: { key: string; label: string; patterns: RegExp }[] = [
  { key: '0-6', label: 'גיל הרך (0-6)', patterns: /גיל הרך|גן|פעוט|תינוק|0.?6/ },
  { key: '6-12', label: 'ילדים (6-12)', patterns: /יסודי|ילדים|6.?12/ },
  { key: '12-18', label: 'נוער (12-18)', patterns: /נוער|תיכון|12.?18|14.?18|בני נוער/ },
  { key: '18-26', label: 'צעירים (18-26)', patterns: /צעירים|18.?26|בוגרים צעירים|סטודנט/ },
  { key: '26-65', label: 'מבוגרים (26-65)', patterns: /מבוגרים|בוגרים|26.?65/ },
  { key: '65+', label: 'גיל שלישי (65+)', patterns: /קשישים|זקנים|65\+|גיל שלישי/ },
];

// ===== Hebrew Tag Taxonomy Mapping =====
// Maps Hebrew interest tags to Goldfish domain/population keys for better matching
export const HEBREW_TAG_TO_DOMAIN: Record<string, string> = {
  'חינוך, השכלה והכשרה מקצועית': 'education',
  'השכלה גבוהה': 'education',
  'חינוך משלים': 'education',
  'חינוך לגיל הרך': 'education',
  'מצויינות': 'education',
  'פיתוח מנהיגות': 'community',
  'בריאות': 'health',
  'בריאות הנפש': 'mental_health',
  'מחקר רפואי': 'health',
  'ציוד רפואי': 'health',
  'בריאות ושירותי חירום': 'health',
  'מצוקה חברתית': 'welfare',
  'שוויון זכויות': 'legal',
  'זכויות אדם': 'legal',
  'עזרה הומניטארית': 'welfare',
  'פיתוח קהילתי': 'community',
  'קהילה וחברה': 'community',
  'חברה משותפת': 'coexistence',
  'רשויות מקומיות': 'community',
  'תעסוקה והכשרה מקצועית': 'employment',
  'יזמות חברתית': 'social_innovation',
  'אומנות': 'culture',
  'תרבות ואמנות': 'culture',
  'מורשת או הנצחה': 'culture',
  'זהות יהודית': 'religion',
  'יהדות ישראלית': 'religion',
  'איכות הסביבה': 'environment',
  'רווחת בעלי חיים': 'environment',
  'כללי (מחקר, מדע וטכנולוגיה)': 'technology',
  'מידע ותקשורת': 'technology',
  'כללי (ספורט)': 'sport',
  'מדעי החברה': 'science',
  'פוליטיקה וממשל': 'community',
  'קשרים בינלאומיים': 'community',
  'פיתוח הנגב והגליל': 'community',
  'הצטיידות': 'infrastructure',
};

export const HEBREW_TAG_TO_POPULATION: Record<string, string> = {
  // Youth
  'ילדים ונוער': 'youth',
  'כללי (ילדים ונוער)': 'youth',
  'נוער': 'youth',
  'ילדים': 'youth',
  'בני נוער': 'youth',
  // At-risk youth
  'ילדים ונוער בסיכון': 'youth_at_risk',
  'נוער בסיכון': 'youth_at_risk',
  'צעירים בסיכון': 'youth_at_risk',
  'נושרים': 'youth_at_risk',
  'נשירה': 'youth_at_risk',
  // Young adults
  'צעירים': 'young_adults',
  'בוגרים צעירים': 'young_adults',
  // Women
  'נשים ונערות': 'women',
  'נשים': 'women',
  'בנות': 'women',
  // Disabilities
  'צרכים מיוחדים ומוגבלויות': 'disabilities',
  'מוגבלויות': 'disabilities',
  'מוגבלות': 'disabilities',
  // Elderly
  'קשישים': 'elderly',
  'גיל שלישי': 'elderly',
  'גיל הזהב': 'elderly',
  // Immigrants/Ethiopian
  'עולים': 'immigrants',
  'יוצאי אתיופיה': 'immigrants',
  'אתיופים': 'immigrants',
  // Arab society
  'חברה ערבית': 'arab',
  'ערבים': 'arab',
  'בדואים': 'arab',
  // Haredi
  'חרדים': 'haredi',
  'חרדי': 'haredi',
  // Soldiers
  'חיילים': 'soldiers',
  'משוחררים': 'soldiers',
  'חיילים משוחררים': 'soldiers',
  // Homeless/poverty
  'חסרי בית': 'homeless',
  'דרי רחוב': 'homeless',
  // Addiction
  'התמכרות': 'addiction',
  'גמילה': 'addiction',
  // LGBTQ
  'להט"ב': 'lgbtq',
  // Refugees
  'פליטים': 'refugees',
  'מבקשי מקלט': 'refugees',
  // Prisoners
  'אסירים': 'prisoners',
  'שחרורי כלא': 'prisoners',
};

// Resolve Hebrew tags from company interests array to Goldfish domain/population keys
// Uses exact map lookup + pattern-based fallback for free-text tags
export function resolveInterestTags(interests: string[]): { domains: string[]; populations: string[] } {
  const domains = new Set<string>();
  const populations = new Set<string>();
  for (const tag of interests) {
    // 1. Exact map lookup
    if (HEBREW_TAG_TO_DOMAIN[tag]) domains.add(HEBREW_TAG_TO_DOMAIN[tag]);
    if (HEBREW_TAG_TO_POPULATION[tag]) populations.add(HEBREW_TAG_TO_POPULATION[tag]);
    // 2. Native slug passthrough
    if (DOMAIN_PATTERNS.some(d => d.key === tag)) domains.add(tag);
    if (POPULATION_PATTERNS.some(p => p.key === tag)) populations.add(tag);
    // 3. Pattern-based fallback for free-text Hebrew tags
    const tagLower = tag.toLowerCase();
    for (const pop of POPULATION_PATTERNS) {
      if (pop.patterns.test(tagLower)) populations.add(pop.key);
    }
    for (const dom of DOMAIN_PATTERNS) {
      if (dom.patterns.test(tagLower)) domains.add(dom.key);
    }
  }
  return { domains: [...domains], populations: [...populations] };
}

// ===== Main DNA Extraction =====

export function extractOrgDNA(
  profile: Record<string, unknown> | null,
  docTexts?: string[]
): OrgDNA {
  // Combine all text sources
  const textParts: string[] = [];

  if (profile) {
    if (profile.mission) textParts.push(String(profile.mission));
    if (profile.name) textParts.push(String(profile.name));
    if (Array.isArray(profile.focus_areas)) textParts.push((profile.focus_areas as string[]).join(' '));
    if (Array.isArray(profile.regions)) textParts.push((profile.regions as string[]).join(' '));
    if (Array.isArray(profile.active_projects)) {
      for (const proj of profile.active_projects as { name?: string; description?: string }[]) {
        if (proj?.name) textParts.push(proj.name);
        if (proj?.description) textParts.push(proj.description);
      }
    }
    if (Array.isArray(profile.key_achievements)) textParts.push((profile.key_achievements as string[]).join(' '));
    if (profile.summary) textParts.push(String(profile.summary));
  }

  if (docTexts) {
    textParts.push(...docTexts);
  }

  const fullText = textParts.join(' ').toLowerCase();

  // Extract populations
  const populations = POPULATION_PATTERNS
    .filter(p => p.patterns.test(fullText))
    .map(p => p.key);

  // Extract domains
  const domains = DOMAIN_PATTERNS
    .filter(d => d.patterns.test(fullText))
    .map(d => d.key);

  // Extract sub-domains (only those whose parent domain is detected)
  const subDomains = SUB_DOMAIN_PATTERNS
    .filter(s => s.patterns.test(fullText) && domains.includes(s.parentDomain))
    .map(s => s.key);

  // Extract intervention types (what the org actually does)
  const interventionTypes = INTERVENTION_PATTERNS
    .filter(i => i.patterns.test(fullText))
    .map(i => i.key);

  // Extract geography
  const geography = GEO_PATTERNS
    .filter(g => g.patterns.test(fullText))
    .map(g => g.key);

  // Extract age groups
  const ageGroups = AGE_PATTERNS
    .filter(a => a.patterns.test(fullText))
    .map(a => a.key);

  // Org size
  const budget = Number(profile?.annual_budget) || 0;
  const employees = Number(profile?.employees_count) || 0;
  const orgType: OrgDNA['orgType'] =
    budget > 5_000_000 || employees > 50 ? 'large' :
    budget > 500_000 || employees > 10 ? 'medium' : 'small';

  // Build themes (more specific than domains)
  const themes: string[] = [];
  if (/מניעת נשירה|מנותק|נושר/.test(fullText)) themes.push('dropout_prevention');
  if (/מלגות|מלגה/.test(fullText)) themes.push('scholarships');
  if (/רדאר|זיהוי מוקדם|איתור/.test(fullText)) themes.push('early_detection');
  if (/ליווי אישי|מנטור|חונכ/.test(fullText)) themes.push('mentoring');
  if (/טכנולוגי|דיגיטל|אפליקצי/.test(fullText)) themes.push('tech_enabled');
  if (/פנימיי/.test(fullText)) themes.push('residential');
  if (/קרקס|אומנ|מוזיקה|תיאטרון/.test(fullText)) themes.push('arts_therapy');
  if (/ספורט|כדורגל/.test(fullText)) themes.push('sports');
  if (/יזמות|סטארט/.test(fullText)) themes.push('entrepreneurship');
  if (/שפה|אנגלית|עברית/.test(fullText)) themes.push('language');
  if (/הורים|משפחה/.test(fullText)) themes.push('family');
  if (/מוביליות|ניעות חברתית|שוויון הזדמנויות/.test(fullText)) themes.push('social_mobility');
  if (/מיצוי זכויות|זכויות סוציאליות/.test(fullText)) themes.push('rights_advocacy');
  if (/בוגרי מערכת|בוגרים|יוצאי מערכת/.test(fullText)) themes.push('care_leavers');

  // Build exclude lists — only exclude populations that are clearly OPPOSITE to the org's mission
  // e.g. an org for youth should NOT be excluded from grants that mention "women" as a secondary population
  // Only exclude if the org has 3+ clear populations AND this population is not among them
  const allPopKeys = POPULATION_PATTERNS.map(p => p.key);
  const HARD_EXCLUDES: Record<string, string[]> = {
    // If org serves youth, exclude elderly-only grants (not mixed grants)
    'youth': ['elderly'],
    'youth_at_risk': ['elderly'],
    'young_adults': ['elderly'],
    // If org serves elderly, exclude youth-only grants
    'elderly': ['youth', 'youth_at_risk', 'young_adults', 'children'],
    // If org serves children, exclude elderly-only grants
    'children': ['elderly'],
  };
  const excludePopulations = allPopKeys.filter(pk => {
    if (populations.length < 3) return false; // Not enough info to exclude
    if (populations.includes(pk)) return false; // Org serves this population
    // Only hard-exclude if there's a clear semantic opposition
    const hardExcludeFor = populations.flatMap(p => HARD_EXCLUDES[p] || []);
    return hardExcludeFor.includes(pk);
  });

  // Only exclude domains we're confident about
  const excludeDomains: string[] = [];
  if (domains.length >= 2) {
    // If org clearly does education + welfare, exclude unrelated domains
    const unrelatedDomains = ['agriculture', 'environment', 'science', 'infrastructure', 'housing'];
    for (const d of unrelatedDomains) {
      if (!domains.includes(d)) excludeDomains.push(d);
    }
  }

  // Profile completeness score
  let completeness = 0;
  if (profile?.name) completeness += 10;
  if (profile?.mission && String(profile.mission).length > 30) completeness += 15;
  if (populations.length > 0) completeness += 15;
  if (domains.length > 0) completeness += 15;
  if (geography.length > 0) completeness += 10;
  if (ageGroups.length > 0) completeness += 5;
  if (interventionTypes.length > 0) completeness += 10;
  if (docTexts && docTexts.length > 0) completeness += 15;
  if (budget > 0) completeness += 5;

  return {
    populations,
    domains,
    subDomains,
    interventionTypes,
    geography,
    ageGroups,
    orgType,
    themes,
    excludePopulations,
    excludeDomains,
    profileCompleteness: Math.min(100, completeness),
  };
}

// ===== Matching Score =====

export function scoreDNAMatch(
  orgDna: OrgDNA,
  oppCategories: string[],
  oppPopulations: string[],
  oppTitle: string,
  oppDescription?: string,
  oppAlsoRelevantFor?: string[]
): { score: number; reasoning: string; isNegativeMatch: boolean } {
  const oppText = `${oppTitle} ${oppDescription || ''}`.toLowerCase();

  let score = 0;
  const reasons: string[] = [];
  let isNegativeMatch = false;

  // 1. NEGATIVE MATCH CHECK — critical, do first

  // Check if the opportunity targets a population the org doesn't serve
  for (const pop of POPULATION_PATTERNS) {
    if (pop.patterns.test(oppText) && orgDna.excludePopulations.includes(pop.key) && !orgDna.populations.includes(pop.key)) {
      isNegativeMatch = true;
      reasons.push(`לא מתאים: מיועד ל${pop.label} והארגון לא עובד עם אוכלוסייה זו`);
      return { score: Math.min(score, 15), reasoning: reasons.join('. '), isNegativeMatch: true };
    }
  }

  // Check if the opportunity is in a domain the org doesn't work in
  const oppDetectedDomainsEarly = DOMAIN_PATTERNS.filter(d => d.patterns.test(oppText)).map(d => d.key);
  const excludedDomainHits = oppDetectedDomainsEarly.filter(d => orgDna.excludeDomains.includes(d));
  const matchedDomainHits = oppDetectedDomainsEarly.filter(d => orgDna.domains.includes(d));

  // If more excluded domains than matching domains, it's a negative match
  if (excludedDomainHits.length > 0 && excludedDomainHits.length >= matchedDomainHits.length) {
    const excludeLabels = excludedDomainHits.map(k => DOMAIN_PATTERNS.find(d => d.key === k)?.label || k);
    isNegativeMatch = true;
    reasons.push(`לא מתאים: תחום ${excludeLabels.join(', ')} לא רלוונטי לארגון`);
    return { score: Math.min(score, 15), reasoning: reasons.join('. '), isNegativeMatch: true };
  }

  // 2. Population match (35 points max — primary gets bonus)
  const oppDetectedPops = POPULATION_PATTERNS.filter(p => p.patterns.test(oppText)).map(p => p.key);
  const popOverlap = oppDetectedPops.filter(p => orgDna.populations.includes(p));
  if (popOverlap.length > 0) {
    const primaryPops = orgDna.primaryPopulations || [];
    const primaryHits = popOverlap.filter(p => primaryPops.includes(p));
    const secondaryHits = popOverlap.filter(p => !primaryPops.includes(p));
    // Primary population match = 20pts each, secondary = 10pts
    const popPoints = Math.min(35, primaryHits.length * 20 + secondaryHits.length * 10);
    score += popPoints;
    const popLabels = popOverlap.map(k => POPULATION_PATTERNS.find(p => p.key === k)?.label || k);
    reasons.push(`אוכלוסייה: ${popLabels.join(', ')}${primaryHits.length > 0 ? ' (ליבה)' : ''}`);
  } else if (oppDetectedPops.length > 0 && orgDna.populations.length > 0) {
    score -= 10;
  }

  // 3. Domain match (30 points max)
  const oppDetectedDomains = DOMAIN_PATTERNS.filter(d => d.patterns.test(oppText)).map(d => d.key);
  // Combine DB categories + text-detected domains, but prioritize text-detected
  const allOppDomains = [...new Set([...oppCategories, ...oppDetectedDomains])];
  const catOverlap = allOppDomains.filter(c => orgDna.domains.includes(c));
  const uniqueCatOverlap = [...new Set(catOverlap)];

  // Penalize when the opportunity has excluded domains even if some categories match
  const hasExcludedDomains = allOppDomains.some(d => orgDna.excludeDomains.includes(d));

  if (uniqueCatOverlap.length > 0) {
    const primaryDoms = orgDna.primaryDomains || [];
    const primaryDomHits = uniqueCatOverlap.filter(d => primaryDoms.includes(d));
    const secondaryDomHits = uniqueCatOverlap.filter(d => !primaryDoms.includes(d));
    // Primary domain = 18pts, secondary = 8pts. Half if excluded domains present
    const rawPoints = primaryDomHits.length * 18 + secondaryDomHits.length * 8;
    const domainPoints = hasExcludedDomains
      ? Math.min(18, Math.floor(rawPoints / 2))
      : Math.min(35, rawPoints);
    score += domainPoints;
    const domainLabels = uniqueCatOverlap.map(k => DOMAIN_PATTERNS.find(d => d.key === k)?.label || k);
    reasons.push(`תחום: ${domainLabels.join(', ')}${primaryDomHits.length > 0 ? ' (ליבה)' : ''}${hasExcludedDomains ? ' (חפיפה חלקית)' : ''}`);
  }

  // 4. Geography match (20 points max)
  const oppDetectedGeo = GEO_PATTERNS.filter(g => g.patterns.test(oppText)).map(g => g.key);
  const geoOverlap = oppDetectedGeo.filter(g => orgDna.geography.includes(g));
  if (geoOverlap.length > 0) {
    score += Math.min(20, geoOverlap.length * 10);
    const geoLabels = geoOverlap.map(k => GEO_PATTERNS.find(g => g.key === k)?.label || k);
    reasons.push(`אזור: ${geoLabels.join(', ')}`);
  } else if (orgDna.geography.includes('national')) {
    score += 5; // National orgs get small geo bonus
  }

  // 5. Age group match (10 points)
  const oppDetectedAges = AGE_PATTERNS.filter(a => a.patterns.test(oppText)).map(a => a.key);
  const ageOverlap = oppDetectedAges.filter(a => orgDna.ageGroups.includes(a));
  if (ageOverlap.length > 0) {
    score += 10;
  } else if (oppDetectedAges.length > 0 && orgDna.ageGroups.length > 0) {
    // Age mismatch
    score -= 5;
    reasons.push(`גיל: לא תואם (${oppDetectedAges.join(', ')} vs ${orgDna.ageGroups.join(', ')})`);
  }

  // 6. Sub-domain match bonus (10 points max)
  const oppDetectedSubDomains = SUB_DOMAIN_PATTERNS.filter(s => s.patterns.test(oppText)).map(s => s.key);
  const subDomainOverlap = oppDetectedSubDomains.filter(s => orgDna.subDomains.includes(s));
  if (subDomainOverlap.length > 0) {
    score += Math.min(10, subDomainOverlap.length * 5);
    const subLabels = subDomainOverlap.map(k => SUB_DOMAIN_PATTERNS.find(s => s.key === k)?.label || k);
    reasons.push(`תת-תחום: ${subLabels.join(', ')}`);
  }

  // 7. Intervention type match bonus (10 points max)
  const oppDetectedInterventions = INTERVENTION_PATTERNS.filter(i => i.patterns.test(oppText)).map(i => i.key);
  const interventionOverlap = oppDetectedInterventions.filter(i => orgDna.interventionTypes.includes(i));
  if (interventionOverlap.length > 0) {
    score += Math.min(10, interventionOverlap.length * 5);
    const intLabels = interventionOverlap.map(k => INTERVENTION_PATTERNS.find(i => i.key === k)?.label || k);
    reasons.push(`סוג התערבות: ${intLabels.join(', ')}`);
  }

  // 8. Theme match bonus (5 points max — reduced since subDomains cover more)
  for (const theme of orgDna.themes) {
    if (oppText.includes(theme.replace(/_/g, ' ')) || oppText.includes(theme)) {
      score += 3;
    }
  }

  // 9. "Also relevant for" — creative matching (15 points max)
  // These are AI-generated tags that indicate the grant is relevant beyond its direct category
  if (oppAlsoRelevantFor && oppAlsoRelevantFor.length > 0) {
    const orgAllTags = [...orgDna.domains, ...orgDna.populations, ...orgDna.subDomains];
    const relevantOverlap = oppAlsoRelevantFor.filter(tag => orgAllTags.includes(tag));
    if (relevantOverlap.length > 0 && popOverlap.length === 0 && uniqueCatOverlap.length === 0) {
      // No direct match but creative match — this is the "seeing beyond" magic
      score += Math.min(15, relevantOverlap.length * 5);
      reasons.push(`רלוונטי גם עבור: ${relevantOverlap.join(', ')}`);
    } else if (relevantOverlap.length > 0) {
      // Has both direct and creative match — small bonus
      score += Math.min(8, relevantOverlap.length * 3);
    }
  }

  // Clamp to 0-100
  const finalScore = Math.max(0, Math.min(100, score));
  const reasoning = reasons.length > 0 ? reasons.join('. ') : 'אין חפיפה ברורה';

  return { score: finalScore, reasoning, isNegativeMatch };
}

// ===== Helper: Format DNA for display =====

export function formatDNAForPrompt(dna: OrgDNA): string {
  const parts: string[] = ['[DNA ארגוני]'];

  if (dna.populations.length > 0) {
    const labels = dna.populations.map(k => POPULATION_PATTERNS.find(p => p.key === k)?.label || k);
    parts.push(`אוכלוסיות: ${labels.join(', ')}`);
  }
  if (dna.domains.length > 0) {
    const labels = dna.domains.map(k => DOMAIN_PATTERNS.find(d => d.key === k)?.label || k);
    parts.push(`תחומים: ${labels.join(', ')}`);
  }
  if (dna.subDomains.length > 0) {
    const labels = dna.subDomains.map(k => SUB_DOMAIN_PATTERNS.find(s => s.key === k)?.label || k);
    parts.push(`תת-תחומים: ${labels.join(', ')}`);
  }
  if (dna.interventionTypes.length > 0) {
    const labels = dna.interventionTypes.map(k => INTERVENTION_PATTERNS.find(i => i.key === k)?.label || k);
    parts.push(`סוגי התערבות: ${labels.join(', ')}`);
  }
  if (dna.geography.length > 0) {
    const labels = dna.geography.map(k => GEO_PATTERNS.find(g => g.key === k)?.label || k);
    parts.push(`גיאוגרפיה: ${labels.join(', ')}`);
  }
  if (dna.ageGroups.length > 0) {
    const labels = dna.ageGroups.map(k => AGE_PATTERNS.find(a => a.key === k)?.label || k);
    parts.push(`קבוצות גיל: ${labels.join(', ')}`);
  }
  parts.push(`גודל ארגון: ${dna.orgType}`);
  if (dna.themes.length > 0) {
    parts.push(`נושאי ליבה: ${dna.themes.join(', ')}`);
  }
  if (dna.excludePopulations.length > 0) {
    const labels = dna.excludePopulations.slice(0, 5).map(k => POPULATION_PATTERNS.find(p => p.key === k)?.label || k);
    parts.push(`לא עובד עם: ${labels.join(', ')}`);
  }

  return parts.join('\n');
}

// ===== AI-Powered DNA Extraction =====
// Runs once when org registers or updates profile. Stores result in org_profiles.
// Much more accurate than regex — understands language, synonyms, context.

export async function extractOrgDNAWithAI(
  orgText: string
): Promise<Partial<OrgDNA> | null> {
  if (!GEMINI_KEY || !orgText.trim()) return null;

  const populationKeys = POPULATION_PATTERNS.map(p => p.key).join(', ');
  const domainKeys = DOMAIN_PATTERNS.map(d => d.key).join(', ');
  const subDomainKeys = SUB_DOMAIN_PATTERNS.map(s => s.key).join(', ');
  const interventionKeys = INTERVENTION_PATTERNS.map(i => i.key).join(', ');
  const geoKeys = GEO_PATTERNS.map(g => g.key).join(', ');
  const ageKeys = AGE_PATTERNS.map(a => a.key).join(', ');

  const prompt = `אתה מנתח ארגוני מגזר שלישי בישראל. קרא את הטקסט הבא על ארגון והחזר JSON בלבד (ללא הסברים).

טקסט הארגון:
${orgText.slice(0, 12000)}

החזר JSON עם המפתחות הבאים בלבד. השתמש רק בערכים מהרשימות שמופיעות כאן:

{
  "populations": [/* מתוך: ${populationKeys} */],
  "domains": [/* מתוך: ${domainKeys} */],
  "primaryDomains": [/* 1-2 תחומים שהם הליבה/המשימה המרכזית של הארגון */],
  "primaryPopulations": [/* 1-2 אוכלוסיות שהן עיקר העבודה */],
  "subDomains": [/* מתוך: ${subDomainKeys} */],
  "interventionTypes": [/* מתוך: ${interventionKeys} */],
  "geography": [/* מתוך: ${geoKeys} */],
  "ageGroups": [/* מתוך: ${ageKeys} */],
  "themes": [/* מילים חופשיות — נושאי ליבה ייחודיים שלא מכוסים ברשימות */]
}

חוקים:
- השתמש רק בערכים שמופיעים ברשימות. אל תמציא ערכים חדשים (חוץ מ-themes שהוא חופשי).
- אם תחום לא מוזכר — אל תכלול אותו.
- subDomains רק אם ה-parentDomain שלהם נמצא ב-domains.
- primaryDomains ו-primaryPopulations: בחר 1-2 בלבד שהם הליבה האמיתית של הארגון (מה שמופיע הכי הרבה, מוזכר ראשון, או מתואר כמשימה המרכזית).
- החזר JSON תקני בלבד, ללא markdown, ללא \`\`\`.`;

  try {
    const res = await fetch(`${GEMINI_BASE}:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 800, temperature: 0 },
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // Validate — only keep known keys
    const allPopKeys = POPULATION_PATTERNS.map(p => p.key);
    const allDomainKeys = DOMAIN_PATTERNS.map(d => d.key);
    const allSubKeys = SUB_DOMAIN_PATTERNS.map(s => s.key);
    const allIntKeys = INTERVENTION_PATTERNS.map(i => i.key);
    const allGeoKeys = GEO_PATTERNS.map(g => g.key);
    const allAgeKeys = AGE_PATTERNS.map(a => a.key);

    return {
      populations: (parsed.populations || []).filter((k: string) => allPopKeys.includes(k)),
      domains: (parsed.domains || []).filter((k: string) => allDomainKeys.includes(k)),
      primaryDomains: (parsed.primaryDomains || []).filter((k: string) => allDomainKeys.includes(k)).slice(0, 2),
      primaryPopulations: (parsed.primaryPopulations || []).filter((k: string) => allPopKeys.includes(k)).slice(0, 2),
      subDomains: (parsed.subDomains || []).filter((k: string) => allSubKeys.includes(k)),
      interventionTypes: (parsed.interventionTypes || []).filter((k: string) => allIntKeys.includes(k)),
      geography: (parsed.geography || []).filter((k: string) => allGeoKeys.includes(k)),
      ageGroups: (parsed.ageGroups || []).filter((k: string) => allAgeKeys.includes(k)),
      themes: (parsed.themes || []).filter((t: unknown) => typeof t === 'string').slice(0, 10),
    };
  } catch {
    return null;
  }
}

// Merge AI-extracted DNA with regex-extracted DNA (union — keep all findings from both)
export function mergeOrgDNA(regexDna: OrgDNA, aiDna: Partial<OrgDNA>): OrgDNA {
  const merged: OrgDNA = {
    populations: [...new Set([...(aiDna.populations || []), ...regexDna.populations])],
    domains: [...new Set([...(aiDna.domains || []), ...regexDna.domains])],
    subDomains: [...new Set([...(aiDna.subDomains || []), ...regexDna.subDomains])],
    interventionTypes: [...new Set([...(aiDna.interventionTypes || []), ...regexDna.interventionTypes])],
    geography: [...new Set([...(aiDna.geography || []), ...regexDna.geography])],
    ageGroups: [...new Set([...(aiDna.ageGroups || []), ...regexDna.ageGroups])],
    orgType: regexDna.orgType,
    themes: [...new Set([...(aiDna.themes || []), ...regexDna.themes])],
    excludePopulations: [],
    excludeDomains: [],
  };

  // Rebuild exclude lists — only hard semantic opposites, not all non-matching populations
  const HARD_EXCLUDES_MERGE: Record<string, string[]> = {
    'youth': ['elderly'], 'youth_at_risk': ['elderly'], 'young_adults': ['elderly'],
    'children': ['elderly'], 'elderly': ['youth', 'youth_at_risk', 'young_adults', 'children'],
  };
  merged.excludePopulations = merged.populations.length >= 3
    ? merged.populations.flatMap(p => HARD_EXCLUDES_MERGE[p] || [])
        .filter(k => !merged.populations.includes(k))
    : [];

  if (merged.domains.length >= 2) {
    const unrelated = ['agriculture', 'environment', 'science', 'infrastructure', 'housing', 'religion', 'sport', 'culture'];
    merged.excludeDomains = unrelated.filter(d => !merged.domains.includes(d));
  }

  return merged;
}
