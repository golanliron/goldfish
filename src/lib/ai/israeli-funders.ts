// Goldfish — Israeli Funders Intelligence
// 50 major Israeli funders: DNA, priorities, approach strategy, contact details
// Amounts/deadlines intentionally omitted — verified in real-time via Tavily

// ===== Approach Strategy Definitions =====
//
// RFP_ONLY    — publishes open calls only. No point cold-emailing.
//               System blocks free-form outreach and points to their RFP calendar.
//
// DIRECT_APPROACH — rolling basis / LOI accepted. System shows exact contact route.
//
// UNKNOWN     — not yet verified. Treat as RFP_ONLY until confirmed.

export interface IsraeliFunderEntry {
  name: string;
  website?: string;
  approach_strategy: 'RFP_ONLY' | 'DIRECT_APPROACH' | 'UNKNOWN';
  /** For DIRECT_APPROACH: real person name+role, NOT "info@" */
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  /** For RFP_ONLY: link to grant calendar / call page */
  rfp_page?: string;
  /** For DIRECT_APPROACH: exact submission instructions */
  submission_instructions?: string;
  focus_areas: string[];
  dna: string;
  likes: string;
  rejects: string;
  tip: string;
}

export const ISRAELI_FUNDERS: IsraeliFunderEntry[] = [

  // ===== פרטיות גדולות =====

  {
    name: 'קרן עזריאלי',
    website: 'https://azrieli.org',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://azrieli.org/he/grants',
    focus_areas: ['חינוך', 'מדע', 'מנהיגות', 'ספורט', 'אדריכלות'],
    dna: 'מצוינות. לא פריפריה בלבד — מצוינות בכל מקום. ארגון עם track record מוכח. מחקר ואקדמיה מוערכים.',
    likes: 'נתונים כמותיים, שיתוף אוניברסיטאות, מנהיגות צעירה, חדשנות מבוססת ראיות.',
    rejects: 'ארגונים חדשים ללא ניסיון מוכח, בקשות גנריות, חסרון מחקר.',
    tip: 'הדגש מצוינות ותוצאות מדידות — לא צורך חברתי בלבד.',
  },

  {
    name: 'יד הנדיב / קרן רוטשילד',
    website: 'https://yadhanadiv.org.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://yadhanadiv.org.il/he/grants',
    focus_areas: ['חינוך', 'סביבה', 'אזרחות', 'מדיניות ציבורית'],
    dna: 'שינוי מערכתי. לא פרויקט — מדיניות. עובדים על רמת מערכת, לא על רמת פרט.',
    likes: 'שיתוף עם ממשלה, השפעה על מדיניות, scale, ארגוני גג.',
    rejects: 'פרויקטים קטנים, עזרה ישירה ללא שינוי מערכתי, ארגונים ללא קשרי ממשלה.',
    tip: 'תראה איך הפרויקט שלך ישנה מדיניות או יגרום לממשלה לאמץ מודל.',
  },

  {
    name: 'קרן רשי',
    website: 'https://rashi.org.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://rashi.org.il/grants',
    focus_areas: ['פריפריה', 'דרום', 'נגב', 'גליל', 'חינוך', 'תעסוקה', 'קהילה'],
    dna: 'פריפריה גיאוגרפית + leverage ממשלתי. רוצים שהמדינה תאמץ ותמשיך.',
    likes: 'שיתוף רשויות מקומיות, קרנות ממשלתיות נוספות, תוצאות מדידות בפריפריה.',
    rejects: 'מרכז הארץ, ללא שותפות ממשלתית, ללא תכנית להמשכיות.',
    tip: 'ציין שיש כבר שיתוף עם רשות מקומית + משרד ממשלתי.',
  },

  {
    name: 'קרן ברלוביץ',
    website: 'https://berelovitz.org.il',
    approach_strategy: 'DIRECT_APPROACH',
    contact_name: 'צוות הקרן',
    contact_email: 'info@berelovitz.org.il',
    submission_instructions: 'פנייה ישירה במייל עם תקציר פרויקט של עמוד אחד. קרן משפחתית — מגיבה לפניות אישיות.',
    focus_areas: ['נוער בסיכון', 'חינוך', 'בריאות נפש', 'עוני'],
    dna: 'קרן משפחתית. יחס אישי. מאמינים בארגונים קטנים-בינוניים שמכירים את השטח.',
    likes: 'ארגון שמכיר עמוק את הקהילה שלו, שקיפות, דיווח ישיר.',
    rejects: 'ארגוני ענק, בקשות כלליות, חוסר מגע ישיר עם המוטבים.',
    tip: 'ספר סיפור אנושי קונקרטי של מוטב — לא סטטיסטיקות בלבד.',
  },

  {
    name: 'קרן מנדל',
    website: 'https://mandelfoundation.org.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://mandelfoundation.org.il/he/programs',
    focus_areas: ['פיתוח מנהיגות', 'חינוך', 'חברה'],
    dna: 'השקעה עמוקה באנשים. לא פרויקטים — מנהיגים. מחזורים של עמיתים (fellows).',
    likes: 'מנהיגים בכירים עם פוטנציאל שינוי שדה, תהליכי למידה ארוכי טווח.',
    rejects: 'פרויקטים חד-פעמיים, ארגונים שרוצים כסף לפרויקט ולא לפיתוח אנשים.',
    tip: 'בקשות למנדל הן בדרך כלל על עמיתות — לא על מענק לפרויקט.',
  },

  {
    name: 'קרן גוטסמן',
    approach_strategy: 'UNKNOWN',
    submission_instructions: 'כניסה דרך המלצות בלבד — לא קיבלת קשר ישיר מ-Goldfish.',
    focus_areas: ['חינוך', 'חברה', 'ישראל-תפוצות'],
    dna: 'שקטה, לא פרסומית. עובדת עם ארגונים מוכרים לה.',
    likes: 'ארגונים שכבר מוכרים לקרן דרך רשת חברתית.',
    rejects: 'פניות קרות ללא הכרות קודמת.',
    tip: 'כניסה דרך המלצות — ג\'וינט, סוכנות, או חבר בורד.',
  },

  {
    name: 'קרן מייברג',
    approach_strategy: 'UNKNOWN',
    submission_instructions: 'פועלת דרך מתווכים — ג\'וינט או ארגוני גג.',
    focus_areas: ['חינוך', 'נוער', 'ישראל'],
    dna: 'פרטית ושקטה. פועלת דרך מתווכים.',
    likes: 'ארגונים שמגיעים דרך המלצה של גורם אמין.',
    rejects: 'פניות ישירות ללא גורם מקשר.',
    tip: 'קשר דרך ג\'וינט או ארגוני גג.',
  },

  {
    name: 'קרן לוי לאסן',
    website: 'https://levilassen.org.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://levilassen.org.il/grants',
    focus_areas: ['נשים', 'שוויון הזדמנויות', 'תעסוקה', 'יזמות נשית'],
    dna: 'העצמת נשים בכל שכבות האוכלוסייה — ערביות, חרדיות, אתיופיות, פריפריה.',
    likes: 'נתונים על פערי מגדר, שיתוף מעסיקים, תוצאות תעסוקתיות מדידות.',
    rejects: 'ארגוני נשים ללא נתוני תעסוקה, כללי מדי, ללא פילוח אוכלוסייה.',
    tip: 'פלח את הנשים בדיוק — גיל, מוצא, אזור, מצב תעסוקתי לפני ואחרי.',
  },

  {
    name: 'קרן ירושלים',
    website: 'https://jerusalemfoundation.org',
    approach_strategy: 'DIRECT_APPROACH',
    contact_name: 'מחלקת המענקים',
    contact_email: 'grants@jerusalemfoundation.org',
    submission_instructions: 'שלח מכתב פנייה (LOI) של עמוד אחד למייל — ירושלים חייבת להיות מוקד, לא רק כתובת.',
    focus_areas: ['ירושלים', 'חינוך', 'תרבות', 'קהילה', 'דו-קיום', 'כלכלה'],
    dna: 'ירושלים קודם. כל גוון של ירושלים — יהודי, ערבי, חרדי, חילוני, עולים.',
    likes: 'שיתוף קהילות שונות, השפעה על העיר, מורשת ופיתוח.',
    rejects: 'ארגונים מחוץ לירושלים, ירושלים כרקע בלבד ולא כמוקד.',
    tip: 'ירושלים חייבת להיות הלב של הבקשה — לא רק הכתובת.',
  },

  {
    name: 'קרן קורת',
    website: 'https://koret.org',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://koret.org/grantmaking',
    focus_areas: ['חינוך יהודי', 'ישראל', 'קהילה יהודית'],
    dna: 'ישראל-תפוצות, זהות יהודית, חינוך ערכי.',
    likes: 'חיבור יהדות-ישראל, תוכניות לנוער יהודי, מנהיגות.',
    rejects: 'ארגונים ללא ממד יהודי מפורש.',
    tip: 'ציין בבירור את הממד היהודי-ישראלי בפרויקט.',
  },

  // ===== ממשלתיות וציבוריות =====

  {
    name: 'מפעל הפיס',
    website: 'https://pais.co.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://pais.co.il/grants',
    focus_areas: ['תרבות', 'ספורט', 'חינוך', 'קהילה', 'נגישות', 'פריפריה'],
    dna: 'נגישות רחבה. רוצים שכמה שיותר אנשים ייהנו. לא עילית — עממי.',
    likes: 'פרויקטים בפריפריה, מבנים ציבוריים, ספורט קהילתי, אמנות נגישה.',
    rejects: 'ארגונים מסחריים, פרויקטים סגורים, ללא מרכיב ציבורי.',
    tip: 'מפעל הפיס = תהליך פשוט יחסית. כדאי להגיש גם ארגונים קטנים.',
  },

  {
    name: 'ועדת העיזבונות',
    website: 'https://gov.il/he/departments/legalentities/inheritance',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://gov.il/he/departments/legalentities/inheritance/grant-applications',
    focus_areas: ['רווחה', 'חינוך', 'בריאות', 'תרבות'],
    dna: 'ממשלתי לחלוטין. ציות, מסמכים, ניהול תקין, ניסיון מוכח.',
    likes: 'ארגונים ותיקים, מסמכים מלאים, דוח מבוקר, track record ארוך.',
    rejects: 'ארגונים חדשים, מסמכים חסרים, ניסיון לא מוכח.',
    tip: 'תהליך ארוך מאוד — שנה ויותר. להגיש רק עם כל המסמכים.',
  },

  {
    name: 'משרד החינוך — פורטל תמיכות',
    website: 'https://tmichot.mof.gov.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://tmichot.mof.gov.il',
    focus_areas: ['חינוך', 'נוער', 'תרבות', 'ספורט'],
    dna: 'ציות מוחלט לתבחינים. שפה פורמלית. יעדים SMART. שיתוף רשויות.',
    likes: 'מדדים כמותיים, שותפות מוסדית, ניסיון מוכח, תבחינים ממולאים בדיוק.',
    rejects: 'חריגה מהתבחינים, שפה שיווקית, ארגונים בלי ניהול תקין.',
    tip: 'קרא את התבחינים 3 פעמים לפני שכותב מילה.',
  },

  {
    name: 'ביטוח לאומי — קרנות ייעודיות',
    website: 'https://btl.gov.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://btl.gov.il/grants',
    focus_areas: ['מוגבלויות', 'קשישים', 'ילדים בסיכון', 'משפחות חד-הוריות'],
    dna: 'אוכלוסיות מוחלשות בלבד. 46א חובה. בירוקרטי ומפורט.',
    likes: 'שיתוף עם שירותי רווחה, נתוני אוכלוסייה מדויקים, ניסיון עם האוכלוסייה.',
    rejects: 'ארגונים ללא ניסיון עם אוכלוסיית היעד הספציפית.',
    tip: 'אישור ניהול תקין + 46א הם חובה מוחלטת.',
  },

  {
    name: 'משרד הרווחה',
    website: 'https://molsa.gov.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://molsa.gov.il/grants',
    focus_areas: ['אלימות במשפחה', 'נוער בסיכון', 'קשישים', 'הומלסים', 'התמכרויות'],
    dna: 'שיתוף עם רשויות מקומיות — חובה. ארגון המשלים את המדינה, לא מחליף.',
    likes: 'שיתוף לשכות רווחה, ניסיון מוכח עם אוכלוסייה, מחקר מלווה.',
    rejects: 'ארגונים שעובדים במקביל לשירותי הרווחה ללא תיאום.',
    tip: 'הסכם שיתוף פעולה עם לשכת הרווחה המקומית — לפני ההגשה.',
  },

  {
    name: 'רשות החדשנות',
    website: 'https://innovationisrael.org.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://innovationisrael.org.il/he/programs',
    focus_areas: ['טכנולוגיה', 'R&D', 'חדשנות עסקית'],
    dna: 'תמיכה בחברות טכנולוגיה, לא עמותות. רלוונטי לעמותות רק בשיתוף חברת הייטק.',
    likes: 'שיתוף חברה טכנולוגית + עמותה, חדשנות חברתית מבוססת טכנולוגיה.',
    rejects: 'עמותות ללא שותף טכנולוגי מסחרי.',
    tip: 'עמותה + חברת הייטק = שיתוף שיכול להיות רלוונטי לחדשנות חברתית.',
  },

  {
    name: 'מינהל קהילה ונוער — עיריות',
    approach_strategy: 'DIRECT_APPROACH',
    submission_instructions: 'פנה ישירות למנהל מחלקת הנוער בעירייה הרלוונטית. קודם הסכם עם העירייה, אחר כך מענק.',
    focus_areas: ['מרכזי נוער', 'פעילות קהילתית', 'תעסוקת נוער'],
    dna: 'שיתוף עירייה חובה מוחלטת. ארגון חיצוני שמפעיל שירות עירוני.',
    likes: 'ניסיון עם נוער באזור, שיתוף עם בתי ספר ורשויות.',
    rejects: 'ארגון שלא מתאם עם העירייה.',
    tip: 'קודם הסכם עם העירייה, אחר כך מענק.',
  },

  // ===== בינלאומיות הפועלות בישראל =====

  {
    name: 'ג\'וינט ישראל / JDC',
    website: 'https://jointisrael.org',
    approach_strategy: 'DIRECT_APPROACH',
    contact_name: 'מחלקת שותפויות',
    contact_email: 'partnerships@jointisrael.org',
    submission_instructions: 'פנייה במייל עם תקציר של עמוד אחד ו-Theory of Change ברורה. ה-JDC מעדיפים שיח לפני הגשה רשמית.',
    focus_areas: ['חדשנות חברתית', 'קשישים', 'קהילות מוחלשות', 'ערבים', 'חרדים'],
    dna: 'evidence-based. חדשנות + מדידה + scale. רוצים ללמוד ולהעביר מודלים.',
    likes: 'pilot עם פוטנציאל הרחבה, מחקר מלווה, שיתוף ממשלתי, impact metrics.',
    rejects: 'שירותים קיימים ללא חדשנות, ארגונים שלא מודדים, ללא theory of change.',
    tip: 'תציג את הפרויקט כ-pilot שה-JDC יוכל להעביר לארגונים אחרים.',
  },

  {
    name: 'קרן שוסטרמן',
    website: 'https://schusterman.org',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://schusterman.org/grants',
    focus_areas: ['חינוך יהודי', 'מנהיגות צעירה', 'ישראל-תפוצות', 'קהילה יהודית'],
    dna: 'אמריקאי. ROI. בוגרי תוכנית = ממשיכים. Leadership pipeline.',
    likes: 'מנהיגים צעירים (20-40), ישראל-תפוצות, יזמות חברתית, alumni network.',
    rejects: 'ארגונים ללא ממד ישראל-תפוצות, ללא מנהיגות, שירותים בלבד.',
    tip: 'הדגש alumni network ותוצאות מנהיגות לאורך זמן.',
  },

  {
    name: 'קרן Jim Joseph',
    website: 'https://jimjosephfoundation.org',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://jimjosephfoundation.org/grants',
    focus_areas: ['חינוך יהודי', 'ישראל', 'נוער יהודי בארה"ב'],
    dna: 'חינוך יהודי בלבד. קהל ארה"ב בעיקר — רלוונטי לישראל בחיבור תפוצות.',
    likes: 'חינוך יהודי בלתי פורמלי, camp, Birthright-adjacent.',
    rejects: 'ארגונים ללא ממד יהודי-חינוכי ברור.',
    tip: 'רלוונטי בעיקר לישראל דרך חיבור תפוצות.',
  },

  {
    name: 'AVI CHAI',
    website: 'https://avichai.org',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://avichai.org/grants',
    focus_areas: ['חינוך יהודי', 'תרבות', 'ישראל-תפוצות'],
    dna: 'הנחלת מסורת יהודית. חינוך שמחבר יהדות וחיים מודרניים.',
    likes: 'תכניות שמחברות יהדות ומודרניות, בתי ספר יהודיים.',
    rejects: 'ארגונים ללא ממד יהודי.',
    tip: 'המיקוד הוא על יהדות + מודרניות = החיבור הזה.',
  },

  {
    name: 'קרן NIF / שתיל',
    website: 'https://nif.org',
    approach_strategy: 'DIRECT_APPROACH',
    contact_name: 'שתיל — מנהלת קשרי ארגונים',
    contact_email: 'info@shatil.org.il',
    submission_instructions: 'פנה לשתיל לייעוץ ראשוני (לא רק מימון). NIF עצמה — בקשות דרך אתר. שתיל = ייעוץ + גישה.',
    focus_areas: ['צדק חברתי', 'זכויות אדם', 'דמוקרטיה', 'מיעוטים', 'נשים', 'פלסטינים אזרחי ישראל'],
    dna: 'rights-based. equity. ביקורת על מדיניות ממשלתית. פרוגרסיבי.',
    likes: 'ארגוני זכויות, קהילות ערביות, נשים בסיכון, מיעוטים.',
    rejects: 'ארגונים שתומכים בממשלה ללא ביקורת, ארגונים ימניים.',
    tip: 'שתיל = תמיכה ייעוצית ולא רק כספית. פנה לייעוץ גם.',
  },

  {
    name: 'קרן ויינברג',
    website: 'https://weinbergfoundation.org',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://weinbergfoundation.org/grant-seekers',
    focus_areas: ['רווחה', 'בריאות', 'קהילה', 'עוני'],
    dna: 'ארגונים מבוססים עם track record. לא חדשים. שותפים מקומיים חזקים.',
    likes: 'ארגונים עם ניסיון רב-שנתי, שותפות קהילתית, אימפקט מוכח.',
    rejects: 'ארגונים חדשים, ללא שותפים מקומיים, ללא ניסיון מוכח.',
    tip: 'ציין מפורשות את שנות הניסיון ורשת השותפים המקומיים.',
  },

  {
    name: 'הסוכנות היהודית',
    website: 'https://jewishagency.org',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://jewishagency.org/grants',
    focus_areas: ['עלייה', 'קליטה', 'זהות יהודית', 'ישראל-תפוצות', 'נוער'],
    dna: 'חיבור יהדות ישראל-תפוצות. עלייה והשתקעות.',
    likes: 'תוכניות קליטה, זהות יהודית, Birthright-adjacent, נוער יהודי בעולם.',
    rejects: 'ארגונים ללא ממד ישראל-תפוצות.',
    tip: 'ציין חיבור לקהילה יהודית בחו"ל.',
  },

  {
    name: 'קק"ל',
    website: 'https://kkl.org.il',
    approach_strategy: 'DIRECT_APPROACH',
    contact_name: 'מחלקת שותפויות קהילתיות',
    contact_email: 'community@kkl.org.il',
    submission_instructions: 'פנייה ישירה עם הצעת שיתוף פעולה — קק"ל מעדיפים partnership, לא מענק בלבד.',
    focus_areas: ['סביבה', 'יער', 'קהילה', 'פריפריה', 'חינוך סביבתי'],
    dna: 'קרקע + סביבה + קהילה. שותפות עם רשויות ועיריות.',
    likes: 'פרויקטים סביבתיים, גינון קהילתי, חינוך לטבע, פריפריה.',
    rejects: 'ארגונים ללא מרכיב סביבתי או קהילתי-גיאוגרפי.',
    tip: 'הצע שיתוף פעולה — לא רק מימון.',
  },

  // ===== בינוניות ומשפחתיות =====

  {
    name: 'קרן אריסון',
    website: 'https://arisongroup.com',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://arisongroup.com/social-impact',
    focus_areas: ['חינוך', 'קהילה', 'כלכלה חברתית', 'מנהיגות'],
    dna: 'אמונה בכוח הפרט לשנות. ערכים יהודיים. מנהיגות אחראית.',
    likes: 'ארגונים שמפתחים מנהיגים, כלכלה חברתית, ערבים ויהודים.',
    rejects: 'שירותים בלבד ללא פיתוח אנשים.',
    tip: 'הדגש פיתוח מנהיגות ואחריות אישית.',
  },

  {
    name: 'קרן מאיר פנחס גנוט',
    approach_strategy: 'UNKNOWN',
    submission_instructions: 'פנייה דרך גופי גג — ג\'וינט, סוכנות, ארגוני חינוך ותיקים.',
    focus_areas: ['חינוך', 'צעירים', 'ישראל'],
    dna: 'פרטית. פועלת דרך מתווכים.',
    likes: 'ארגונים שמגיעים דרך המלצה.',
    rejects: 'פניות ישירות.',
    tip: 'פנייה דרך גופי גג.',
  },

  {
    name: 'קרן הלנה רובינשטיין',
    website: 'https://helena-rubinstein.co.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://helena-rubinstein.co.il/grants',
    focus_areas: ['אמנות', 'תרבות', 'אופנה', 'עיצוב'],
    dna: 'תמיכה באמנים ויוצרים ישראלים. לא ארגוני שירות.',
    likes: 'אמנים ויוצרים עצמאיים, פרויקטי תרבות.',
    rejects: 'עמותות שירות ללא מרכיב יצירתי.',
    tip: 'רלוונטי לאמנים ויוצרים — לא לעמותות שירות.',
  },

  {
    name: 'קרן פוקס',
    approach_strategy: 'UNKNOWN',
    submission_instructions: 'פנייה דרך המלצות בלבד — אין דרך ישירה.',
    focus_areas: ['חינוך', 'רווחת ילדים'],
    dna: 'פרטית. פניות דרך המלצות בלבד.',
    likes: 'ארגונים שמגיעים דרך המלצה.',
    rejects: 'פניות ישירות.',
    tip: 'פנייה דרך המלצות בלבד.',
  },

  {
    name: 'קרן משפחת רקנאטי',
    approach_strategy: 'DIRECT_APPROACH',
    submission_instructions: 'פנייה ישירה עם הצעה מפורטת. ממוקדים בתרבות ומורשת ישראלית.',
    focus_areas: ['תרבות', 'אמנות', 'חינוך', 'ישראל'],
    dna: 'מורשת ותרבות ישראלית. מוזיאונים, אמנות, מחקר.',
    likes: 'מוזיאונים, אמנות, מורשת, מחקר ישראלי.',
    rejects: 'ארגונים ללא מרכיב תרבותי.',
    tip: 'ממד תרבותי-ישראלי חייב להיות מרכזי.',
  },

  {
    name: 'קרן צ\'ק פוינט (CSR)',
    website: 'https://checkpoint.com',
    approach_strategy: 'DIRECT_APPROACH',
    contact_name: 'מנהל CSR',
    contact_email: 'csr@checkpoint.com',
    submission_instructions: 'פנייה ישירה למנהל CSR עם הצעה קצרה (עמוד אחד) על תוכנית STEM/סייבר.',
    focus_areas: ['חינוך טכנולוגי', 'סייבר', 'STEM', 'נוער בהייטק'],
    dna: 'הכנת הדור הבא להייטק. ללא קשר לעסק הליבה של החברה.',
    likes: 'תוכניות קידוד, סייבר, STEM, מגוון בהייטק.',
    rejects: 'פרויקטים ללא קשר לטכנולוגיה.',
    tip: 'הצג קשר ישיר לעולם הסייבר/הייטק.',
  },

  {
    name: 'קרן טבע (CSR)',
    website: 'https://teva.co.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://teva.co.il/corporate-responsibility/community',
    focus_areas: ['בריאות', 'נגישות לרפואה', 'קהילות מוחלשות'],
    dna: 'בריאות = ליבה. הנגשת רפואה לאוכלוסיות ללא גישה.',
    likes: 'בריאות קהילתית, מניעה, חינוך בריאות, נגישות.',
    rejects: 'פרויקטים ללא קשר לבריאות.',
    tip: 'קשר לנגישות רפואה — הליבה של טבע.',
  },

  {
    name: 'קרן אלביט מערכות (CSR)',
    website: 'https://elbit.co.il',
    approach_strategy: 'DIRECT_APPROACH',
    contact_name: 'מנהל אחריות תאגידית',
    contact_email: 'csr@elbitsystems.com',
    submission_instructions: 'פנייה ישירה — ממוקדים בחינוך טכנולוגי, חיילים ופריפריה.',
    focus_areas: ['חינוך טכנולוגי', 'ביטחון', 'חיילים'],
    dna: 'ביטחון וטכנולוגיה. חיילים + STEM + פריפריה.',
    likes: 'חיילים, STEM, פריפריה.',
    rejects: 'פרויקטים ללא קשר לביטחון או טכנולוגיה.',
    tip: 'חיילים + STEM + פריפריה = שילוב מנצח.',
  },

  {
    name: 'בנק לאומי — קרן לאומי (CSR)',
    website: 'https://leumi.co.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://leumi.co.il/community',
    focus_areas: ['חינוך פיננסי', 'יזמות', 'קהילה'],
    dna: 'אוריינות פיננסית. יזמות כלכלית. תרומה לקהילות שבהן הם פועלים.',
    likes: 'אוריינות פיננסית, יזמות כלכלית, קהילות עם סניפי לאומי.',
    rejects: 'ארגונים ללא קשר לפיננסים או כלכלה.',
    tip: 'קשר לאוריינות פיננסית יגביר הרלוונטיות.',
  },

  {
    name: 'בנק הפועלים — קרן (CSR)',
    website: 'https://bankhapoalim.co.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://bankhapoalim.co.il/community',
    focus_areas: ['חינוך', 'תרבות', 'קהילה', 'ספורט'],
    dna: 'פיזור רחב. כמה שיותר קהילות. נוכחות ברחבי הארץ.',
    likes: 'פרויקטים ברחבי הארץ, קהילות מגוונות.',
    rejects: 'פרויקטים נקודתיים מאוד ללא השפעה רחבה.',
    tip: 'הדגש את הפיזור הגיאוגרפי והאוכלוסייתי.',
  },

  {
    name: 'קרן פדרציה תל אביב-יפו',
    website: 'https://jafi.org',
    approach_strategy: 'DIRECT_APPROACH',
    contact_name: 'מנהלת קרנות',
    contact_email: 'grants@telfed.org.il',
    submission_instructions: 'פנייה ישירה לצוות — ממוקדים בתל אביב-יפו, עולים וגיוון תרבותי.',
    focus_areas: ['תרבות', 'קהילה', 'חינוך', 'עולים'],
    dna: 'תל אביב-יפו. גיוון תרבותי. עולים ומהגרים.',
    likes: 'שיתוף קהילות מגוונות, עולים, תרבות עירונית.',
    rejects: 'ארגונים מחוץ לאזור ת"א-יפו.',
    tip: 'מיקוד גיאוגרפי ברור: ת"א-יפו.',
  },

  // ===== ייעודיות לתחומים ספציפיים =====

  {
    name: 'קרן רמון',
    website: 'https://ramonfoundation.org.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://ramonfoundation.org.il/grants',
    focus_areas: ['מדע', 'חלל', 'חינוך מדעי', 'השראה לנוער'],
    dna: 'זיכרון אילן רמון. חינוך מדעי + חלום גדול + ישראל.',
    likes: 'STEM, חינוך מדעי, יצירתיות, חדשנות, נוער מצטיין.',
    rejects: 'פרויקטים ללא מרכיב מדעי-חינוכי.',
    tip: 'חיבור לחלל, מדע ויצירתיות — ה-DNA של הקרן.',
  },

  {
    name: 'קרן אנה פרנק ישראל',
    website: 'https://annefrank.org.il',
    approach_strategy: 'DIRECT_APPROACH',
    contact_email: 'info@annefrank.org.il',
    submission_instructions: 'פנייה ישירה במייל — ממוקדים בחינוך לזיכרון, סובלנות ודו-קיום.',
    focus_areas: ['שואה', 'חינוך לזיכרון', 'סובלנות', 'דו-קיום'],
    dna: 'חינוך לזיכרון השואה + מניעת גזענות ושנאה.',
    likes: 'חינוך לסובלנות, מניעת בריונות ושנאה.',
    rejects: 'ארגונים ללא קשר לחינוך לזיכרון.',
    tip: 'הדגש ממד הסובלנות ומניעת גזענות.',
  },

  {
    name: 'קרן ספיר',
    website: 'https://sapir.org.il',
    approach_strategy: 'RFP_ONLY',
    rfp_page: 'https://sapir.org.il/community',
    focus_areas: ['פריפריה', 'חינוך', 'תעסוקה', 'קהילה', 'נגב'],
    dna: 'נגב + פריפריה דרומית. חינוך גבוה, תעסוקה, פיתוח אזורי.',
    likes: 'ארגונים שפועלים בנגב, שיתוף עם מכללת ספיר, פיתוח אזורי.',
    rejects: 'ארגונים מחוץ לאזור הנגב והדרום.',
    tip: 'ספיר = אזור הנגב. מיקוד גיאוגרפי ברור.',
  },

  {
    name: 'קרן גולדה מאיר',
    website: 'https://golda-meir-fund.org.il',
    approach_strategy: 'DIRECT_APPROACH',
    contact_email: 'info@golda-meir-fund.org.il',
    submission_instructions: 'פנייה ישירה — ממוקדים במנהיגות נשית ושוויון מגדרי.',
    focus_areas: ['נשים', 'מנהיגות נשית', 'שוויון מגדרי'],
    dna: 'מנהיגות נשית ברוח גולדה. נשים במעמדות בכירים, פוליטיקה, חברה.',
    likes: 'מנהיגות נשית, פוליטיקה, עמדות בכירות.',
    rejects: 'פרויקטים נשיים ללא מרכיב מנהיגות.',
    tip: 'הדגש מנהיגות ועמדות השפעה — לא שירות בלבד.',
  },

  {
    name: 'קרן חרמון',
    approach_strategy: 'UNKNOWN',
    submission_instructions: 'פנייה דרך גורמים מקומיים בצפון.',
    focus_areas: ['חינוך', 'ספורט', 'קהילה בצפון'],
    dna: 'צפון הארץ. קהילות ספר. ספורט קהילתי.',
    likes: 'ארגונים הפועלים בצפון, ספורט קהילתי.',
    rejects: 'ארגונים מחוץ לצפון.',
    tip: 'פנייה דרך גורמים מקומיים בצפון.',
  },

  {
    name: 'קרן יד שרה',
    website: 'https://yadsarah.org.il',
    approach_strategy: 'DIRECT_APPROACH',
    contact_email: 'info@yadsarah.org.il',
    submission_instructions: 'פנייה ישירה לשיתוף פעולה — יד שרה היא בעיקר ארגון נותן שירות, לא מממן. הצע שיתוף פעולה.',
    focus_areas: ['עזרה לחולים ומוגבלים', 'ציוד רפואי', 'התנדבות'],
    dna: 'עזרה הדדית. התנדבות כערך. ציוד רפואי בהשאלה.',
    likes: 'שיתוף פעולה, שירותים משלימים.',
    rejects: 'בקשות מימון ישיר — יד שרה היא ארגון שירות, לא מממן.',
    tip: 'בעיקר שיתוף פעולה — לא מימון ישיר.',
  },

  {
    name: 'קרן EcoOcean',
    website: 'https://ecoocean.org.il',
    approach_strategy: 'DIRECT_APPROACH',
    contact_email: 'info@ecoocean.org.il',
    submission_instructions: 'פנייה ישירה למייל עם הצעת שיתוף פעולה — ממוקדים בים, טבע וחינוך סביבתי.',
    focus_areas: ['סביבה ימית', 'חינוך סביבתי'],
    dna: 'ים, טבע, מחקר ימי, חינוך סביבתי לנוער.',
    likes: 'חינוך סביבתי, מחקר ימי, שמירת טבע.',
    rejects: 'ארגונים ללא מרכיב סביבתי.',
    tip: 'מיקוד בים ועולם הסביבה.',
  },

  {
    name: 'קרן EcoPeace Middle East',
    website: 'https://ecopeaceme.org',
    approach_strategy: 'DIRECT_APPROACH',
    contact_email: 'info@ecopeaceme.org',
    submission_instructions: 'פנייה ישירה — ממוקדים בסביבה ישראל-ירדן-פלסטינאים.',
    focus_areas: ['סביבה', 'דו-קיום ישראל-ערב-פלסטינאים'],
    dna: 'שיתוף סביבתי ישראל-ירדן-פלסטינאים. מים, אנרגיה, טבע כגשר.',
    likes: 'שיתוף אזורי, סביבה כגשר שלום.',
    rejects: 'ארגונים ללא ממד אזורי/שלום.',
    tip: 'סביבה כגשר שלום אזורי — ה-DNA של הקרן.',
  },

  {
    name: 'ידיד',
    website: 'https://yadid-ngo.org',
    approach_strategy: 'DIRECT_APPROACH',
    contact_email: 'info@yadid-ngo.org',
    submission_instructions: 'פנה לשיתוף פעולה ולא מימון — ידיד מציעה ייעוץ משפטי-חברתי.',
    focus_areas: ['זכויות אדם', 'זכויות חברתיות', 'שירותי רווחה'],
    dna: 'ייעוץ משפטי-חברתי לאוכלוסיות מוחלשות. שיתוף פעולה ולא מימון.',
    likes: 'שיתוף פעולה, שירותים משלימים לזכויות.',
    rejects: 'בקשות מימון ישיר — ידיד היא ארגון שירות.',
    tip: 'שיתוף פעולה — לא מימון ישיר.',
  },

  {
    name: 'קרן חי',
    approach_strategy: 'UNKNOWN',
    submission_instructions: 'פנייה דרך המלצות — אין דרך ישירה.',
    focus_areas: ['בריאות', 'רפואה', 'אוכלוסיות מוחלשות'],
    dna: 'בריאות, רפואה, אוכלוסיות מוחלשות.',
    likes: 'בריאות קהילתית, טיפול באוכלוסיות מוחלשות.',
    rejects: 'פניות ישירות ללא המלצה.',
    tip: 'פנייה דרך המלצות.',
  },

  {
    name: 'קרן שניידר (CSR)',
    approach_strategy: 'DIRECT_APPROACH',
    contact_email: 'csr@schneider.org.il',
    submission_instructions: 'פנייה ישירה — ממוקדים בבריאות ילדים.',
    focus_areas: ['ילדים', 'בריאות ילדים', 'חינוך'],
    dna: 'בית החולים שניידר. בריאות ילדים = ליבה.',
    likes: 'בריאות ילדים, מחקר ילדים, שירותי ילדים.',
    rejects: 'פרויקטים ללא קשר לבריאות ילדים.',
    tip: 'בריאות ילדים — חובה.',
  },

];

// ===== Static Knowledge String (for prompt injection) =====
export const ISRAELI_FUNDERS_INTELLIGENCE = buildFundersString();

function buildFundersString(): string {
  const rfp = ISRAELI_FUNDERS.filter(f => f.approach_strategy === 'RFP_ONLY');
  const direct = ISRAELI_FUNDERS.filter(f => f.approach_strategy === 'DIRECT_APPROACH');
  const unknown = ISRAELI_FUNDERS.filter(f => f.approach_strategy === 'UNKNOWN');

  const lines: string[] = [
    '===== קרנות ישראליות מרכזיות — DNA ומודיעין =====',
    '',
    'כלל ברזל: סכומים ודדליינים מדויקים — בדוק תמיד בזמן אמת (Tavily).',
    'כלל ברזל 2: RFP_ONLY = אסור לייעץ פנייה חופשית — הפנה לעמוד הקולות הקוראים שלהן.',
    'כלל ברזל 3: DIRECT_APPROACH = הצג את פרטי הקשר המדויקים כולל הנחיות הגשה.',
    '',
    `== קרנות RFP בלבד (${rfp.length}) — פנייה אסורה, רק מעקב קולות קוראים ==`,
    '',
  ];

  for (const f of rfp) {
    lines.push(`• ${f.name}${f.rfp_page ? ` | קולות קוראים: ${f.rfp_page}` : ''}`);
    lines.push(`  תחומים: ${f.focus_areas.join(', ')}`);
    lines.push(`  DNA: ${f.dna}`);
    lines.push(`  פוסל: ${f.rejects}`);
    lines.push(`  טיפ: ${f.tip}`);
    lines.push('');
  }

  lines.push(`== קרנות פתוחות לפנייה ישירה (${direct.length}) ==`);
  lines.push('');

  for (const f of direct) {
    lines.push(`• ${f.name}${f.website ? ` (${f.website})` : ''}`);
    if (f.contact_name) lines.push(`  איש קשר: ${f.contact_name}`);
    if (f.contact_email) lines.push(`  מייל: ${f.contact_email}`);
    if (f.submission_instructions) lines.push(`  הנחיות: ${f.submission_instructions}`);
    lines.push(`  תחומים: ${f.focus_areas.join(', ')}`);
    lines.push(`  DNA: ${f.dna}`);
    lines.push(`  טיפ: ${f.tip}`);
    lines.push('');
  }

  if (unknown.length > 0) {
    lines.push(`== קרנות לא מאומתות (${unknown.length}) — זהירות בייעוץ ==`);
    lines.push('');
    for (const f of unknown) {
      lines.push(`• ${f.name}: ${f.submission_instructions || 'לא ידוע — דורש בירור'}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ===== Lookup Helpers =====

export function getFunderByName(name: string): IsraeliFunderEntry | undefined {
  const lower = name.toLowerCase().trim();
  return ISRAELI_FUNDERS.find(f =>
    f.name.toLowerCase().includes(lower) || lower.includes(f.name.toLowerCase().replace('קרן ', ''))
  );
}

export function getFundersByStrategy(strategy: 'RFP_ONLY' | 'DIRECT_APPROACH' | 'UNKNOWN'): IsraeliFunderEntry[] {
  return ISRAELI_FUNDERS.filter(f => f.approach_strategy === strategy);
}

export function getFundersByDomain(domain: string): IsraeliFunderEntry[] {
  const lower = domain.toLowerCase();
  return ISRAELI_FUNDERS.filter(f =>
    f.focus_areas.some(a => a.toLowerCase().includes(lower))
  );
}
