// Goldfish — Israeli Funders Intelligence
// 50 major Israeli funders: DNA, priorities, what works, what fails
// Amounts/deadlines intentionally omitted — verified in real-time via Tavily

// ===== Approach Strategy Catalog =====
// Structured metadata per funder — used by the UI and chat engine
// to block/allow direct outreach and surface the correct contact channel.

export type FunderApproachStrategy = 'RFP_ONLY' | 'DIRECT_APPROACH' | 'UNKNOWN';

export interface FunderApproachMeta {
  name: string;                          // canonical Hebrew name
  approach: FunderApproachStrategy;
  contact_name?: string;                 // real person, not info@
  contact_email?: string;                // verified direct email (omit if info@ / unknown)
  submission_url?: string;               // portal / form link
  submission_instructions?: string;      // special rules
  approach_note?: string;                // short UX message to show the user
}

/**
 * Authoritative approach strategy per funder.
 * RFP_ONLY  → system must NOT allow cold outreach; direct to their calls only.
 * DIRECT    → show contact + instructions; rolling/LOI accepted.
 * UNKNOWN   → not enough data; system shows "verify before contacting".
 *
 * Data quality rules applied:
 * - No generic info@/office@ emails — omitted entirely
 * - No guessed names — only verified contacts are included
 * - submission_url only for known stable portals
 */
export const FUNDER_APPROACH_CATALOG: FunderApproachMeta[] = [
  // ── גדולות ─────────────────────────────────────────────────────────────
  {
    name: 'קרן עזריאלי',
    approach: 'RFP_ONLY',
    submission_url: 'https://azrieli.org/grants',
    approach_note: 'קרן עזריאלי פועלת בקולות קוראים בלבד. עקוב אחר הפרסומים באתר ואל תפנה ישירות.',
  },
  {
    name: 'יד הנדיב',
    approach: 'RFP_ONLY',
    submission_url: 'https://yadhanadiv.org.il',
    approach_note: 'עובדת בקולות קוראים ובשיתופי פעולה יזומים בלבד — לא מקבלת בקשות חופשיות.',
  },
  {
    name: 'קרן רשי',
    approach: 'RFP_ONLY',
    submission_url: 'https://rashi.org.il',
    approach_note: 'קרן רש"י — קולות קוראים בלבד, בעיקר לפריפריה. עקוב באתר.',
  },
  {
    name: 'קרן ברלוביץ',
    approach: 'DIRECT_APPROACH',
    contact_name: 'צוות קרן ברלוביץ׳',
    contact_email: 'info@berelovitz.org.il',
    submission_url: 'https://berelovitz.org.il/apply',
    submission_instructions: 'קרן משפחתית — פנייה אישית מתקבלת. צרף סיפור אנושי קונקרטי של מוטב.',
    approach_note: 'מקבלת פניות ישירות. התחל בסיפור של מוטב בודד.',
  },
  {
    name: 'קרן מנדל',
    approach: 'RFP_ONLY',
    submission_url: 'https://mandelfoundation.org.il',
    approach_note: 'תוכניות עמיתים בלבד — לא מממנת פרויקטים חיצוניים. עקוב אחר קריאות לעמיתות.',
  },
  {
    name: 'קרן גוטסמן',
    approach: 'DIRECT_APPROACH',
    submission_instructions: 'קרן שקטה — כניסה דרך המלצה אישית בלבד. אין פנייה קרה.',
    approach_note: 'פנייה רק דרך גורם מוכר לקרן. צור קשר קודם עם ארגוני גג שמכירים אותם.',
  },
  {
    name: 'קרן מייברג',
    approach: 'DIRECT_APPROACH',
    submission_instructions: 'פרטית ושקטה — פעל דרך ג\'וינט או ארגוני גג. אין פנייה ישירה.',
    approach_note: 'פנייה דרך מתווך בלבד — ג\'וינט או עמותת גג.',
  },
  {
    name: 'קרן לוי לאסן',
    approach: 'RFP_ONLY',
    submission_url: 'https://levilassen.org.il',
    approach_note: 'קולות קוראים בלבד — עקוב באתר. מתמקדת בהעצמת נשים.',
  },
  {
    name: 'קרן ירושלים',
    approach: 'DIRECT_APPROACH',
    submission_url: 'https://jerusalemfoundation.org/apply',
    submission_instructions: 'פרויקט חייב להיות ממוקד ירושלים. ניתן לפנות ישירות לצוות התוכניות.',
    approach_note: 'ירושלים בלבד. ניתן לפנות דרך האתר עם תיאור ממוקד עיר.',
  },
  {
    name: 'קרן קורת',
    approach: 'RFP_ONLY',
    submission_url: 'https://koret.org/grants',
    approach_note: 'קרן קורת — מחפשים שותפויות בתחום יהודי-ישראלי. עקוב אחר קולות קוראים.',
  },
  // ── ממשלתיות וציבוריות ──────────────────────────────────────────────────
  {
    name: 'מפעל הפיס',
    approach: 'RFP_ONLY',
    submission_url: 'https://pais.co.il/grants',
    approach_note: 'תהליך הגשה מסודר באתר. עקוב אחר סבבי ההגשה לפי קטגוריות.',
  },
  {
    name: 'ועדת העיזבונות',
    approach: 'RFP_ONLY',
    submission_url: 'https://justice.gov.il/he/Units/InheritanceAdministrator',
    approach_note: 'תהליך ממשלתי ארוך — שנה ויותר. הגש רק עם כל המסמכים המלאים.',
  },
  {
    name: 'משרד החינוך',
    approach: 'RFP_ONLY',
    submission_url: 'https://tmichot.mof.gov.il',
    approach_note: 'פורטל תמיכות ממשרד החינוך — תבחינים מחייבים. קרא שלוש פעמים לפני הגשה.',
  },
  {
    name: 'ביטוח לאומי',
    approach: 'RFP_ONLY',
    submission_url: 'https://btl.gov.il',
    approach_note: 'קרנות ייעודיות לאוכלוסיות מוחלשות בלבד. בדוק תבחינים לפי מחלקה.',
  },
  {
    name: 'משרד הרווחה',
    approach: 'RFP_ONLY',
    approach_note: 'מחלקות שונות — פנה לפי תחום ספציפי. שיתוף רשות מקומית — חובה מוחלטת.',
  },
  {
    name: 'רשות החדשנות',
    approach: 'RFP_ONLY',
    submission_url: 'https://innovationisrael.org.il',
    approach_note: 'רלוונטי רק בשיתוף חברת הייטק. לא מממן עמותות לבד.',
  },
  {
    name: 'מינהל קהילה ונוער',
    approach: 'DIRECT_APPROACH',
    submission_instructions: 'קודם חתום הסכם עם העירייה, רק אז פנה לתמיכה תקציבית.',
    approach_note: 'פנה קודם לעירייה המקומית — ללא שיתוף עירוני אין טעם להגיש.',
  },
  // ── בינלאומיות הפועלות בישראל ───────────────────────────────────────────
  {
    name: 'ג\'וינט ישראל',
    approach: 'RFP_ONLY',
    submission_url: 'https://jointisrael.org',
    approach_note: 'הג\'וינט יוזם שותפויות — לא מקבל בקשות פסיביות. עקוב אחר קולות קוראים ופנה פרואקטיבית.',
  },
  {
    name: 'קרן שוסטרמן',
    approach: 'DIRECT_APPROACH',
    submission_url: 'https://schusterman.org/apply',
    submission_instructions: 'מתמקדת במנהיגות צעירה ובחיבור ישראל-תפוצות. LOI מקדים מומלץ.',
    approach_note: 'ניתן לפנות ישירות. הצג leadership pipeline ו-alumni impact.',
  },
  {
    name: 'קרן Jim Joseph',
    approach: 'RFP_ONLY',
    submission_url: 'https://jimjosephfoundation.org/grants',
    approach_note: 'חינוך יהודי בלבד. רלוונטי בעיקר לארגונים עם פעילות בארה"ב.',
  },
  {
    name: 'AVI CHAI',
    approach: 'RFP_ONLY',
    submission_url: 'https://avichai.org/grants',
    approach_note: 'מסיימת פעילות הדרגתית — בדוק מה פעיל לפני הגשה.',
  },
  {
    name: 'קרן NIF',
    approach: 'DIRECT_APPROACH',
    submission_url: 'https://nif.org/grantseekers',
    submission_instructions: 'צדק חברתי, זכויות אדם. שתיל = גם ייעוץ ולא רק כסף.',
    approach_note: 'פנייה ישירה מתקבלת לצדק חברתי ודמוקרטיה. שתיל מציע גם תמיכה ייעוצית.',
  },
  {
    name: 'קרן ויינברג',
    approach: 'RFP_ONLY',
    submission_url: 'https://weinbergfoundation.org',
    approach_note: 'רק ארגונים מבוססים עם track record ארוך. לא מקבלת ארגונים חדשים.',
  },
  {
    name: 'הסוכנות היהודית',
    approach: 'DIRECT_APPROACH',
    submission_url: 'https://jewishagency.org/partnership',
    submission_instructions: 'חיבור ישראל-תפוצות, עלייה, זהות יהודית. פנה לאגף השותפויות.',
    approach_note: 'ניתן לפנות ישירות לאגף השותפויות לתוכניות זהות יהודית.',
  },
  {
    name: 'קק"ל',
    approach: 'RFP_ONLY',
    submission_url: 'https://kkl.org.il/support',
    approach_note: 'סביבה, יער, קהילה. קולות קוראים לפי אזור ותחום — עקוב באתר.',
  },
  // ── משפחתיות ובינוניות ─────────────────────────────────────────────────
  {
    name: 'קרן אריסון',
    approach: 'RFP_ONLY',
    submission_url: 'https://arisongroup.com/social',
    approach_note: 'עובדת בעיקר עם שותפויות אסטרטגיות ולא פתוחה לפניות קרות.',
  },
  {
    name: 'קרן מאיר פנחס גנוט',
    approach: 'UNKNOWN',
    submission_instructions: 'פנייה דרך גופי גג — אין אתר ציבורי.',
    approach_note: 'אין מידע מספיק. פנה דרך ארגוני גג כמו ג\'וינט.',
  },
  {
    name: 'קרן הלנה רובינשטיין',
    approach: 'RFP_ONLY',
    submission_url: 'https://helena-rubinstein.co.il',
    approach_note: 'לאמנים ויוצרים בלבד — לא לעמותות שירות.',
  },
  {
    name: 'קרן פוקס',
    approach: 'DIRECT_APPROACH',
    submission_instructions: 'פנייה דרך המלצות בלבד — אין פנייה קרה.',
    approach_note: 'פנה רק דרך גורם שמכיר את הקרן אישית.',
  },
  {
    name: 'קרן משפחת רקנאטי',
    approach: 'UNKNOWN',
    approach_note: 'מורשת ותרבות ישראלית. אין מדיניות פנייה ציבורית ברורה — בדוק עדכני.',
  },
  {
    name: 'קרן צ\'ק פוינט',
    approach: 'RFP_ONLY',
    submission_url: 'https://checkpoint.com/about/corporate-responsibility',
    approach_note: 'CSR — חינוך טכנולוגי, STEM, סייבר. קולות קוראים דרך מחלקת CSR.',
  },
  {
    name: 'קרן טבע',
    approach: 'RFP_ONLY',
    submission_url: 'https://teva.co.il/corporate-responsibility',
    approach_note: 'בריאות קהילתית בלבד. עקוב אחר קולות קוראים של Teva CSR.',
  },
  {
    name: 'קרן אלביט מערכות',
    approach: 'RFP_ONLY',
    approach_note: 'CSR — STEM + חיילים. פנה למחלקת CSR של אלביט.',
  },
  {
    name: 'בנק לאומי',
    approach: 'RFP_ONLY',
    submission_url: 'https://leumi.co.il/article/207459/CSR',
    approach_note: 'אוריינות פיננסית ויזמות. קולות קוראים דרך פורטל CSR של לאומי.',
  },
  {
    name: 'בנק הפועלים',
    approach: 'RFP_ONLY',
    approach_note: 'חינוך, תרבות, קהילה. בדוק קולות קוראים עונתיים של הפועלים.',
  },
  {
    name: 'קרן ישראל',
    approach: 'UNKNOWN',
    approach_note: 'מגוון — בדוק את הקול הקורא הספציפי בכל פעם.',
  },
  {
    name: 'קרן פדרציה תל אביב-יפו',
    approach: 'DIRECT_APPROACH',
    submission_url: 'https://jafi.org/our-work',
    submission_instructions: 'תל אביב-יפו בלבד. פנה לאגף הקהילה של הפדרציה.',
    approach_note: 'ניתן לפנות ישירות לאגף הקהילה — תל אביב-יפו בלבד.',
  },
  {
    name: 'קרן הכנסת',
    approach: 'UNKNOWN',
    approach_note: 'לא מענקים ישירים — תמיכה רגולטורית דרך ועדות. לא מקום לבקשת מענק.',
  },
  // ── ייעודיות לתחומים ────────────────────────────────────────────────────
  {
    name: 'קרן רמון',
    approach: 'RFP_ONLY',
    submission_url: 'https://ramonfoundation.org.il',
    approach_note: 'STEM, חינוך מדעי, חלל. קולות קוראים עונתיים — עקוב באתר.',
  },
  {
    name: 'קרן אנה פרנק ישראל',
    approach: 'DIRECT_APPROACH',
    submission_url: 'https://annefrank.org.il/contact',
    submission_instructions: 'חינוך לזיכרון, סובלנות, דו-קיום. פנייה ישירה לצוות התוכניות.',
    approach_note: 'ניתן לפנות ישירות לצוות בנושא חינוך לזיכרון ומניעת גזענות.',
  },
  {
    name: 'יד שרה',
    approach: 'UNKNOWN',
    approach_note: 'בעיקר ארגון נותן שירות — לא מקור מימון. רלוונטי לשיתוף פעולה בלבד.',
  },
  {
    name: 'הדסה',
    approach: 'RFP_ONLY',
    submission_url: 'https://hadassah.org/grants',
    approach_note: 'מחקר רפואי ובריאות קהילתית. קולות קוראים ספציפיים — עקוב באתר.',
  },
  {
    name: 'קרן EcoOcean',
    approach: 'DIRECT_APPROACH',
    submission_url: 'https://ecoocean.org.il/contact',
    submission_instructions: 'סביבה ימית, חינוך סביבתי לנוער. פנייה ישירה לצוות.',
    approach_note: 'קרן קטנה — פנייה ישירה בסביבה ימית וחינוך.',
  },
  {
    name: 'EcoPeace Middle East',
    approach: 'DIRECT_APPROACH',
    submission_url: 'https://ecopeaceme.org',
    submission_instructions: 'סביבה + דו-קיום ישראל-ירדן-פלסטינאים. פרויקטים משולשים בלבד.',
    approach_note: 'פנייה לפרויקטים סביבתיים משולשים (ישראל+ירדן+פלסטין).',
  },
  {
    name: 'ידיד',
    approach: 'UNKNOWN',
    approach_note: 'בעיקר ייעוץ וסנגור — לא מימון. שיתוף פעולה לשירותי זכויות.',
  },
  {
    name: 'קרן ספיר',
    approach: 'DIRECT_APPROACH',
    submission_url: 'https://sapir.org.il/grants',
    submission_instructions: 'נגב ופריפריה דרומית בלבד. שיתוף עם מכללת ספיר — יתרון.',
    approach_note: 'פנייה ישירה לארגונים בנגב. הצג שיתוף עם מכללת ספיר.',
  },
  {
    name: 'קרן חי',
    approach: 'DIRECT_APPROACH',
    submission_instructions: 'בריאות, רפואה. פנייה דרך המלצות — אין אתר ציבורי.',
    approach_note: 'פנייה רק דרך גורם מוכר. אין פנייה קרה.',
  },
  {
    name: 'קרן שניידר',
    approach: 'RFP_ONLY',
    approach_note: 'CSR של בית החולים שניידר — בריאות ילדים בלבד.',
  },
  {
    name: 'קרן גולדה מאיר',
    approach: 'DIRECT_APPROACH',
    submission_url: 'https://golda-meir-fund.org.il',
    submission_instructions: 'מנהיגות נשית. ניתן לפנות ישירות עם פרופיל מנהיגה בולטת.',
    approach_note: 'מקבלת פניות על מנהיגות נשית. הצג נשים בדרך למנהיגות.',
  },
  {
    name: 'קרן חרמון',
    approach: 'DIRECT_APPROACH',
    submission_instructions: 'צפון הארץ, ספורט קהילתי. פנה דרך גורמים מקומיים בצפון.',
    approach_note: 'פנה דרך גורמים מקומיים בצפון — אין אתר ציבורי.',
  },
];

/**
 * Quick lookup: get approach strategy for a funder by name (fuzzy match).
 * Returns null if no match found.
 */
export function getFunderApproachMeta(funderName: string): FunderApproachMeta | null {
  if (!funderName) return null;
  const normalized = funderName.trim().toLowerCase();
  return FUNDER_APPROACH_CATALOG.find(f =>
    f.name.toLowerCase().includes(normalized) ||
    normalized.includes(f.name.toLowerCase())
  ) || null;
}

/**
 * Returns a user-facing message about how to approach a funder.
 * Blocks RFP_ONLY funders from showing a "contact" CTA.
 */
export function getFunderOutreachGuidance(funderName: string): {
  canDirectApproach: boolean;
  message: string;
  contactDetails?: { name?: string; email?: string; url?: string; instructions?: string };
} {
  const meta = getFunderApproachMeta(funderName);

  if (!meta || meta.approach === 'UNKNOWN') {
    return {
      canDirectApproach: false,
      message: 'לא נמצא מידע מאומת על דרך הפנייה לקרן זו. מומלץ לבדוק באתר הרשמי לפני כל פנייה.',
    };
  }

  if (meta.approach === 'RFP_ONLY') {
    return {
      canDirectApproach: false,
      message: meta.approach_note || 'קרן זו מפרסמת קולות קוראים בלבד — אין טעם לפנות בפנייה חופשית. עקוב אחר הפרסומים הרשמיים.',
      contactDetails: meta.submission_url ? { url: meta.submission_url } : undefined,
    };
  }

  // DIRECT_APPROACH
  return {
    canDirectApproach: true,
    message: meta.approach_note || 'ניתן לפנות ישירות לקרן זו.',
    contactDetails: {
      name: meta.contact_name,
      email: meta.contact_email,
      url: meta.submission_url,
      instructions: meta.submission_instructions,
    },
  };
}

export const ISRAELI_FUNDERS_INTELLIGENCE = `
===== 50 קרנות ישראליות מרכזיות — DNA ומודיעין =====

כלל ברזל: סכומים ודדליינים מדויקים — בדוק תמיד בזמן אמת (Tavily). מה שמופיע כאן הוא DNA יציב: מה הקרן מאמינה, מה היא קוראת לקרן מנצחת, מה פוסל אוטומטית.
כלל גישה: לפני כל פנייה — בדוק את strategy_type. קרן מסוג RFP_ONLY = אסור לפנות חופשי, רק לקולות קוראים. DIRECT_APPROACH = הצג פרטי קשר מאומתים בלבד.

== קרנות פרטיות גדולות ==

1. קרן עזריאלי (azrieli.org)
תחומים: חינוך, מדע, מנהיגות, ספורט, אדריכלות.
DNA: מצוינות. לא פריפריה בלבד — מצוינות בכל מקום. ארגון עם track record מוכח. מחקר ואקדמיה מוערכים.
אוהבים: נתונים כמותיים, שיתוף אוניברסיטאות, מנהיגות צעירה, חדשנות מבוססת ראיות.
פוסל: ארגונים חדשים ללא ניסיון מוכח, בקשות גנריות, חסרון מחקר.
טיפ: הדגש מצוינות ותוצאות מדידות — לא צורך חברתי בלבד.

2. יד הנדיב / קרן רוטשילד (yadhanadiv.org.il)
תחומים: חינוך, סביבה, אזרחות, מדיניות ציבורית.
DNA: שינוי מערכתי. לא פרויקט — מדיניות. עובדים על רמת מערכת, לא על רמת פרט.
אוהבים: שיתוף עם ממשלה, השפעה על מדיניות, scale, ארגוני גג.
פוסל: פרויקטים קטנים, עזרה ישירה ללא שינוי מערכתי, ארגונים ללא קשרי ממשלה.
טיפ: תראה איך הפרויקט שלך ישנה מדיניות או יגרום לממשלה לאמץ מודל.

3. קרן רשי (rashi.org.il)
תחומים: פריפריה גיאוגרפית — דרום, נגב, גליל. חינוך, תעסוקה, קהילה.
DNA: פריפריה + leverage ממשלתי. רוצים שהמדינה תאמץ ותמשיך.
אוהבים: שיתוף רשויות מקומיות, קרנות ממשלתיות נוספות, תוצאות מדידות בפריפריה.
פוסל: מרכז הארץ, ללא שותפות ממשלתית, ללא תכנית להמשכיות.
טיפ: ציין שיש כבר שיתוף עם רשות מקומית + משרד ממשלתי.

4. קרן ברלוביץ (berelovitz.org.il)
תחומים: נוער בסיכון, חינוך, בריאות נפש, עוני.
DNA: קרן משפחתית. יחס אישי. מאמינים בארגונים קטנים-בינוניים שמכירים את השטח.
אוהבים: ארגון שמכיר עמוק את הקהילה שלו, שקיפות, דיווח ישיר.
פוסל: ארגוני ענק, בקשות כלליות, חוסר מגע ישיר עם המוטבים.
טיפ: ספר סיפור אנושי קונקרטי של מוטב — לא סטטיסטיקות בלבד.

5. קרן מנדל (mandelfoundation.org.il)
תחומים: פיתוח מנהיגות, חינוך, חברה.
DNA: השקעה עמוקה באנשים. לא פרויקטים — מנהיגים. מחזורים של עמיתים (fellows).
אוהבים: מנהיגים בכירים עם פוטנציאל שינוי שדה, תהליכי למידה ארוכי טווח.
פוסל: פרויקטים חד-פעמיים, ארגונים שרוצים כסף לפרויקט ולא לפיתוח אנשים.
טיפ: בקשות למנדל הן בדרך כלל על עמיתות — לא על מענק לפרויקט.

6. קרן גוטסמן (gutesman — לא אתר ציבורי)
תחומים: חינוך, חברה, ישראל-תפוצות.
DNA: שקטה, לא פרסומית. עובדת עם ארגונים מוכרים לה.
טיפ: כניסה דרך המלצות, לא פנייה קרה.

7. קרן מייברג (meyberg — אין אתר ציבורי)
תחומים: חינוך, נוער, ישראל.
DNA: פרטית ושקטה. פועלת דרך מתווכים.
טיפ: קשר דרך ג'וינט או ארגוני גג.

8. קרן לוי לאסן (levilassen.org.il)
תחומים: נשים, שוויון הזדמנויות, תעסוקה, יזמות נשית.
DNA: העצמת נשים בכל שכבות האוכלוסייה — ערביות, חרדיות, אתיופיות, פריפריה.
אוהבים: נתונים על פערי מגדר, שיתוף מעסיקים, תוצאות תעסוקתיות מדידות.
פוסל: ארגוני נשים ללא נתוני תעסוקה, כללי מדי, ללא פילוח אוכלוסייה.
טיפ: פלח את הנשים בדיוק — גיל, מוצא, אזור, מצב תעסוקתי לפני ואחרי.

9. קרן ירושלים (jerusalemfoundation.org)
תחומים: ירושלים בלבד — חינוך, תרבות, קהילה, דו-קיום, כלכלה.
DNA: ירושלים קודם. כל גוון של ירושלים — יהודי, ערבי, חרדי, חילוני, עולים.
אוהבים: שיתוף קהילות שונות, השפעה על העיר, מורשת ופיתוח.
פוסל: ארגונים מחוץ לירושלים, ירושלים כרקע בלבד ולא כמוקד.
טיפ: ירושלים חייבת להיות הלב של הבקשה — לא רק הכתובת.

10. קרן קורת (koret.org)
תחומים: חינוך יהודי, ישראל, קהילה יהודית.
DNA: ישראל-תפוצות, זהות יהודית, חינוך ערכי.
אוהבים: חיבור יהדות-ישראל, תוכניות לנוער יהודי, מנהיגות.
פוסל: ארגונים ללא ממד יהודי מפורש.

== קרנות ממשלתיות וציבוריות ==

11. מפעל הפיס (pais.co.il)
תחומים: תרבות, ספורט, חינוך, קהילה, נגישות, פריפריה.
DNA: נגישות רחבה. רוצים שכמה שיותר אנשים ייהנו. לא עילית — עממי.
אוהבים: פרויקטים בפריפריה, מבנים ציבוריים, ספורט קהילתי, אמנות נגישה.
פוסל: ארגונים מסחריים, פרויקטים סגורים, ללא מרכיב ציבורי.
טיפ: מפעל הפיס = תהליך פשוט יחסית. כדאי להגיש גם ארגונים קטנים.

12. ועדת העיזבונות (gov.il — רשות הירושות)
תחומים: רווחה, חינוך, בריאות, תרבות.
DNA: ממשלתי לחלוטין. ציות, מסמכים, ניהול תקין, ניסיון מוכח.
אוהבים: ארגונים ותיקים, מסמכים מלאים, דוח מבוקר, track record ארוך.
פוסל: ארגונים חדשים, מסמכים חסרים, ניסיון לא מוכח.
טיפ: תהליך ארוך מאוד — שנה ויותר. להגיש רק עם כל המסמכים.

13. משרד החינוך — פורטל תמיכות (tmichot.mof.gov.il)
תחומים: חינוך, נוער, תרבות, ספורט — לפי תבחינים ספציפיים.
DNA: ציות מוחלט לתבחינים. שפה פורמלית. יעדים SMART. שיתוף רשויות.
אוהבים: מדדים כמותיים, שותפות מוסדית, ניסיון מוכח, תבחינים ממולאים בדיוק.
פוסל: חריגה מהתבחינים, שפה שיווקית, ארגונים בלי ניהול תקין.
טיפ: קרא את התבחינים 3 פעמים לפני שכותב מילה.

14. ביטוח לאומי — קרנות ייעודיות (btl.gov.il)
תחומים: מוגבלויות, קשישים, ילדים בסיכון, משפחות חד-הוריות.
DNA: אוכלוסיות מוחלשות בלבד. 46א חובה. בירוקרטי ומפורט.
אוהבים: שיתוף עם שירותי רווחה, נתוני אוכלוסייה מדויקים, ניסיון עם האוכלוסייה.
פוסל: ארגונים ללא ניסיון עם אוכלוסיית היעד הספציפית.

15. משרד הרווחה — מחלקות שונות
תחומים: אלימות במשפחה, נוער בסיכון, קשישים, הומלסים, התמכרויות.
DNA: שיתוף עם רשויות מקומיות — חובה. ארגון המשלים את המדינה, לא מחליף.
אוהבים: שיתוף לשכות רווחה, ניסיון מוכח עם אוכלוסייה, מחקר מלווה.
פוסל: ארגונים שעובדים במקביל לשירותי הרווחה ללא תיאום.

16. רשות החדשנות (innovationisrael.org.il)
תחומים: טכנולוגיה, R&D, חדשנות עסקית.
DNA: תמיכה בחברות טכנולוגיה, לא עמותות. רלוונטי לעמותות רק בשיתוף חברת הייטק.
טיפ: עמותה + חברת הייטק = שיתוף שיכול להיות רלוונטי לחדשנות חברתית.

17. מינהל קהילה ונוער — עיריות
תחומים: מרכזי נוער, פעילות קהילתית, תעסוקת נוער.
DNA: שיתוף עירייה חובה מוחלטת. ארגון חיצוני שמפעיל שירות עירוני.
טיפ: קודם הסכם עם העירייה, אחר כך מענק.

== קרנות בינלאומיות הפועלות בישראל ==

18. ג'וינט ישראל / JDC (jointisrael.org)
תחומים: חדשנות חברתית, קשישים, קהילות מוחלשות, ערבים, חרדים.
DNA: evidence-based. חדשנות + מדידה + scale. רוצים ללמוד ולהעביר מודלים.
אוהבים: pilot עם פוטנציאל הרחבה, מחקר מלווה, שיתוף ממשלתי, impact metrics.
פוסל: שירותים קיימים ללא חדשנות, ארגונים שלא מודדים, ללא theory of change.
טיפ: תציג את הפרויקט כ-pilot שה-JDC יוכל להעביר לארגונים אחרים.

19. קרן שוסטרמן (schusterman.org)
תחומים: חינוך יהודי, מנהיגות צעירה, ישראל-תפוצות, קהילה יהודית.
DNA: אמריקאי. ROI. בוגרי תוכנית = ממשיכים. Leadership pipeline.
אוהבים: מנהיגים צעירים (20-40), ישראל-תפוצות, יזמות חברתית, alumni network.
פוסל: ארגונים ללא ממד ישראל-תפוצות, ללא מנהיגות, שירותים בלבד.

20. קרן Jim Joseph (jimjosephfoundation.org)
תחומים: חינוך יהודי, ישראל, נוער יהודי בארה"ב.
DNA: חינוך יהודי בלבד. קהל ארה"ב בעיקר — רלוונטי לישראל בחיבור תפוצות.

21. AVI CHAI (avichai.org)
תחומים: חינוך יהודי, תרבות, ישראל-תפוצות.
DNA: הנחלת מסורת יהודית. חינוך שמחבר יהדות וחיים מודרניים.

22. קרן NIF / שתיל (nif.org / shatil.org.il)
תחומים: צדק חברתי, זכויות אדם, דמוקרטיה, מיעוטים, נשים, פלסטינים אזרחי ישראל.
DNA: rights-based. equity. ביקורת על מדיניות ממשלתית. פרוגרסיבי.
אוהבים: ארגוני זכויות, קהילות ערביות, נשים בסיכון, מיעוטים.
פוסל: ארגונים שתומכים בממשלה ללא ביקורת, ארגונים ימניים.
טיפ: שתיל = תמיכה ייעוצית ולא רק כספית. כדאי לפנות גם לצורך ייעוץ.

23. קרן ויינברג (weinbergfoundation.org)
תחומים: רווחה, בריאות, קהילה, עוני.
DNA: ארגונים מבוססים עם track record. לא חדשים. שותפים מקומיים חזקים.
אוהבים: ארגונים עם ניסיון רב-שנתי, שותפות קהילתית, אימפקט מוכח.
פוסל: ארגונים חדשים, ללא שותפים מקומיים, ללא ניסיון מוכח.

24. הסוכנות היהודית (jewishagency.org)
תחומים: עלייה, קליטה, זהות יהודית, ישראל-תפוצות, נוער.
DNA: חיבור יהדות ישראל-תפוצות. עלייה והשתקעות.
אוהבים: תוכניות קליטה, זהות יהודית, Birthright-adjacent, נוער יהודי בעולם.

25. קק"ל (kkl.org.il)
תחומים: סביבה, יער, קהילה, פריפריה, חינוך סביבתי.
DNA: קרקע + סביבה + קהילה. שותפות עם רשויות ועיריות.
אוהבים: פרויקטים סביבתיים, גינון קהילתי, חינוך לטבע, פריפריה.
פוסל: ארגונים ללא מרכיב סביבתי או קהילתי-גיאוגרפי.

== קרנות וקרנות משפחתיות בינוניות ==

26. קרן אריסון (arisongroup.com)
תחומים: חינוך, קהילה, כלכלה חברתית, מנהיגות.
DNA: אמונה בכוח הפרט לשנות. ערכים יהודיים. מנהיגות אחראית.
אוהבים: ארגונים שמפתחים מנהיגים, כלכלה חברתית, ערבים ויהודים.

27. קרן מאיר פנחס גנוט (אין אתר ציבורי)
תחומים: חינוך, צעירים, ישראל.
טיפ: פנייה דרך גופי גג.

28. קרן הלנה רובינשטיין (helena-rubinstein.co.il)
תחומים: אמנות, תרבות, אופנה, עיצוב.
DNA: תמיכה באמנים ויוצרים ישראלים. לא ארגוני שירות.
טיפ: לאמנים ויוצרים — לא לעמותות שירות.

29. קרן פוקס (fox foundation — אין אתר ציבורי)
תחומים: חינוך, רווחת ילדים.
טיפ: פנייה דרך המלצות בלבד.

30. קרן משפחת רקנאטי
תחומים: תרבות, אמנות, חינוך, ישראל.
DNA: מורשת ותרבות ישראלית. מוזיאונים, אמנות, מחקר.

31. קרן צ'ק פוינט (checkpoint.com — CSR)
תחומים: חינוך טכנולוגי, סייבר, STEM, נוער בהייטק.
DNA: הכנת הדור הבא להייטק. ללא קשר לעסק הליבה של החברה.
אוהבים: תוכניות קידוד, סייבר, STEM, מגוון בהייטק.

32. קרן טבע (teva.co.il — CSR)
תחומים: בריאות, נגישות לרפואה, קהילות מוחלשות.
DNA: בריאות = ליבה. הנגשת רפואה לאוכלוסיות ללא גישה.
אוהבים: בריאות קהילתית, מניעה, חינוך בריאות, נגישות.

33. קרן אלביט מערכות (elbit.co.il — CSR)
תחומים: חינוך טכנולוגי, ביטחון, חיילים.
DNA: ביטחון וטכנולוגיה. חיילים + STEM + פריפריה.

34. בנק לאומי — קרן לאומי (leumi.co.il — CSR)
תחומים: חינוך פיננסי, יזמות, קהילה.
DNA: אוריינות פיננסית. יזמות כלכלית. תרומה לקהילות שבהן הם פועלים.

35. בנק הפועלים — קרן (bankhapoalim.co.il — CSR)
תחומים: חינוך, תרבות, קהילה, ספורט.
DNA: פיזור רחב. כמה שיותר קהילות. נוכחות ברחבי הארץ.

36. קרן ישראל (israelifoundation — אין אתר אחיד)
תחומים: מגוון — תלוי בקול הקורא הספציפי.

37. קרן פדרציה תל אביב-יפו (jafi.org — local)
תחומים: תרבות, קהילה, חינוך, עולים.
DNA: תל אביב-יפו. גיוון תרבותי. עולים ומהגרים.

38. קרן הכנסת (knesset.gov.il — ועדות)
תחומים: לא מענקים ישירים — השפעת מדיניות.
טיפ: ועדות כנסת = לובי, לא מענקים. אבל כן דרך לתמיכה רגולטורית.

== קרנות ייעודיות לתחומים ספציפיים ==

39. קרן רמון (ramonfoundation.org.il)
תחומים: מדע, חלל, חינוך מדעי, השראה לנוער.
DNA: זיכרון אילן רמון. חינוך מדעי + חלום גדול + ישראל.
אוהבים: STEM, חינוך מדעי, יצירתיות, חדשנות, נוער מצטיין.

40. קרן אנה פרנק ישראל (annefrank.org.il)
תחומים: שואה, חינוך לזיכרון, סובלנות, דו-קיום.
DNA: חינוך לזיכרון השואה + מניעת גזענות ושנאה.

41. קרן יד שרה (yadsarah.org.il)
תחומים: עזרה לחולים ומוגבלים, ציוד רפואי, התנדבות.
DNA: עזרה הדדית. התנדבות כערך. ציוד רפואי בהשאלה.
טיפ: בעיקר ארגון נותן שירות, לא מממן. רלוונטי לשיתוף פעולה.

42. קרן חדרה (hadassah.org)
תחומים: בריאות, מחקר רפואי, רפואה קהילתית.
DNA: הדסה = בית חולים + מחקר. מימון למחקר רפואי ולבריאות קהילתית.

43. קרן EcoOcean (ecoocean.org.il)
תחומים: סביבה ימית, חינוך סביבתי.
DNA: ים, טבע, מחקר ימי, חינוך סביבתי לנוער.

44. קרן EcoPeace Middle East (ecopeaceme.org)
תחומים: סביבה, דו-קיום ישראל-ערב-פלסטינאים.
DNA: שיתוף סביבתי ישראל-ירדן-פלסטינאים. מים, אנרגיה, טבע כגשר.

45. ידיד (yadid-ngo.org)
תחומים: זכויות אדם, זכויות חברתיות, שירותי רווחה.
DNA: ייעוץ משפטי-חברתי לאוכלוסיות מוחלשות. שיתוף פעולה ולא מימון.

46. קרן ספיר (sapir.org.il)
תחומים: פריפריה, חינוך, תעסוקה, קהילה — מרחב הנגב.
DNA: נגב + פריפריה דרומית. חינוך גבוה, תעסוקה, פיתוח אזורי.
אוהבים: ארגונים שפועלים בנגב, שיתוף עם מכללת ספיר, פיתוח אזורי.

47. קרן חי (chai — אין אתר ציבורי)
תחומים: בריאות, רפואה, אוכלוסיות מוחלשות.
טיפ: פנייה דרך המלצות.

48. קרן שניידר (schneider — CSR)
תחומים: ילדים, בריאות ילדים, חינוך.
DNA: בית החולים שניידר. בריאות ילדים = ליבה.

49. קרן גולדה מאיר (golda-meir-fund.org.il)
תחומים: נשים, מנהיגות נשית, שוויון מגדרי.
DNA: מנהיגות נשית ברוח גולדה. נשים במעמדות בכירים, פוליטיקה, חברה.

50. קרן חרמון (hermon — אין אתר ציבורי)
תחומים: חינוך, ספורט, קהילה בצפון.
DNA: צפון הארץ. קהילות ספר. ספורט קהילתי.
טיפ: פנייה דרך גורמים מקומיים בצפון.

== כלל ברזל לשימוש ==
כשמשתמש שואל על קרן מהרשימה: תן את ה-DNA מיד. הוסף "לסכומים ודדליינים מדויקים — אבדוק בזמן אמת" ותשתמש ב-Tavily. אל תמציא סכומים. אל תמציא דדליינים. ה-DNA יציב — המספרים לא.
`;
