// Goldfish — Israeli Companies CSR Intelligence
// Authoritative catalog of major Israeli companies + CSR DNA
// Used by: enrich-companies, submission-engine, chat outreach drafting
//
// Data quality rules:
// - NO generic emails (info@, office@, csr@, support@) — omitted entirely
// - contact_name = real verified person or null
// - csr_focus_tags = Hebrew tags matching org DNA taxonomy
// - outreach_tone = guides AI copywriting style

export type DonationType = 'cash' | 'volunteering' | 'equipment' | 'pro_bono' | 'mixed';
export type OutreachTone = 'formal' | 'innovative' | 'community' | 'impact_driven' | 'relationship';
export type CompanyApproach = 'OPEN' | 'RFP_ONLY' | 'REFERRAL_ONLY' | 'UNKNOWN';

export interface CompanyCSRProfile {
  name: string;                    // canonical Hebrew name
  name_en?: string;                // English name for matching
  website: string;                 // official website
  company_type: 'tech' | 'finance' | 'pharma' | 'food' | 'retail' | 'media' | 'telecom' | 'industrial' | 'energy' | 'real_estate';
  csr_focus_tags: string[];        // Hebrew tags: נוער, חינוך טכנולוגי, פריפריה, etc.
  donation_types: DonationType[];
  outreach_tone: OutreachTone;
  approach: CompanyApproach;
  contact_name?: string;           // real person — CSR manager / community relations
  contact_role?: string;           // their role title
  contact_email?: string;          // verified personal email — NOT info@
  submission_url?: string;         // CSR application portal
  submission_instructions?: string;
  approach_note: string;           // UX message for user
  typical_grant_range?: string;    // e.g. "20,000–100,000 ₪"
  preferred_org_size?: string;     // small / medium / large
  red_flags?: string[];            // automatic disqualifiers
}

/**
 * Master CSR catalog — 40+ major Israeli companies.
 * Approach OPEN = accepts direct outreach + attach brief + impact data.
 * RFP_ONLY = portal/annual call only — no cold email.
 * REFERRAL_ONLY = employee or partner introduction required.
 */
export const ISRAELI_COMPANIES_CSR_CATALOG: CompanyCSRProfile[] = [

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // HIGH-TECH & STARTUP
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'צ׳ק פוינט טכנולוגיות',
    name_en: 'Check Point',
    website: 'https://checkpoint.com',
    company_type: 'tech',
    csr_focus_tags: ['חינוך טכנולוגי', 'STEM', 'סייבר', 'נוער', 'מגוון בהייטק'],
    donation_types: ['cash', 'volunteering', 'pro_bono'],
    outreach_tone: 'innovative',
    approach: 'OPEN',
    submission_url: 'https://checkpoint.com/about/corporate-responsibility',
    submission_instructions: 'פנה למחלקת CSR עם brief של עמוד אחד. הדגש כשרון טכנולוגי ופוטנציאל הייטק.',
    approach_note: 'פתוחים לפניות ישירות — הצג תוכנית STEM עם נתוני ערוץ לתעשייה.',
    typical_grant_range: '50,000–300,000 ₪',
    red_flags: ['לא קשור להייטק', 'ללא נתוני תפוקה'],
  },
  {
    name: 'אינטל ישראל',
    name_en: 'Intel Israel',
    website: 'https://intel.com/il',
    company_type: 'tech',
    csr_focus_tags: ['חינוך טכנולוגי', 'STEM', 'נשים בטכנולוגיה', 'פריפריה', 'מיעוטים בהייטק'],
    donation_types: ['cash', 'volunteering', 'equipment'],
    outreach_tone: 'innovative',
    approach: 'OPEN',
    submission_instructions: 'פנה למחלקת Community Relations של אינטל ישראל (חיפה/פ"ת). הדגש diversity ו-pipeline לתעשייה.',
    approach_note: 'תוכנית CSR פעילה — דגש על נשים ומיעוטים בהייטק ופריפריה.',
    typical_grant_range: '100,000–500,000 ₪',
    red_flags: ['ללא קשר לטכנולוגיה', 'ארגון מחוץ לאזור פעילות אינטל'],
  },
  {
    name: 'מלאנוקס / NVIDIA ישראל',
    name_en: 'NVIDIA Israel',
    website: 'https://nvidia.com',
    company_type: 'tech',
    csr_focus_tags: ['חינוך טכנולוגי', 'AI', 'STEM', 'נוער מצוין'],
    donation_types: ['cash', 'volunteering'],
    outreach_tone: 'innovative',
    approach: 'UNKNOWN',
    submission_instructions: 'פנה לצוות HR/Community ישראל. הדגש AI ו-deep tech.',
    approach_note: 'תוכנית CSR מתפתחת — בדוק עדכני לפני פנייה.',
  },
  {
    name: 'פלייטיקה',
    name_en: 'Playtika',
    website: 'https://playtika.com',
    company_type: 'tech',
    csr_focus_tags: ['נוער', 'חינוך', 'קהילה', 'יזמות'],
    donation_types: ['cash', 'volunteering'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה דרך אתר ה-CSR. הדגש פיתוח קהילתי ונוער.',
    approach_note: 'פתוחים לפניות — חברה צעירה עם מחויבות קהילתית גוברת.',
    typical_grant_range: '30,000–150,000 ₪',
  },
  {
    name: 'וואלה קומוניקיישנס',
    name_en: 'Walla Communications',
    website: 'https://walla.co.il',
    company_type: 'media',
    csr_focus_tags: ['תקשורת', 'קהילה', 'חינוך'],
    donation_types: ['pro_bono', 'mixed'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לצוות השיווק/יחסי ציבור. הציע שיתוף תוכן ולא רק כסף.',
    approach_note: 'מדיה — מעדיפים שיתוף תוכן ו-exposure על פני כסף.',
  },
  {
    name: 'רדיוס',
    name_en: 'Radware',
    website: 'https://radware.com',
    company_type: 'tech',
    csr_focus_tags: ['חינוך טכנולוגי', 'STEM'],
    donation_types: ['cash', 'volunteering'],
    outreach_tone: 'innovative',
    approach: 'UNKNOWN',
    approach_note: 'בדוק תוכנית CSR עדכנית לפני פנייה.',
  },
  {
    name: 'אאוטבריין',
    name_en: 'Outbrain',
    website: 'https://outbrain.com',
    company_type: 'tech',
    csr_focus_tags: ['חינוך', 'נוער'],
    donation_types: ['cash', 'volunteering'],
    outreach_tone: 'innovative',
    approach: 'UNKNOWN',
    approach_note: 'פעילות CSR לא ציבורית — פנה לצוות ישראל.',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FINANCE & BANKING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'בנק הפועלים',
    name_en: 'Bank Hapoalim',
    website: 'https://bankhapoalim.co.il',
    company_type: 'finance',
    csr_focus_tags: ['חינוך פיננסי', 'יזמות', 'קהילה', 'ספורט', 'תרבות', 'שוויון הזדמנויות'],
    donation_types: ['cash', 'volunteering'],
    outreach_tone: 'community',
    approach: 'RFP_ONLY',
    submission_url: 'https://bankhapoalim.co.il/corporate-responsibility',
    approach_note: 'קולות קוראים עונתיים — עקוב באתר. דגש על פיזור גיאוגרפי רחב.',
    typical_grant_range: '10,000–80,000 ₪',
  },
  {
    name: 'בנק לאומי',
    name_en: 'Bank Leumi',
    website: 'https://leumi.co.il',
    company_type: 'finance',
    csr_focus_tags: ['חינוך פיננסי', 'יזמות', 'נשים', 'קהילה'],
    donation_types: ['cash', 'volunteering', 'pro_bono'],
    outreach_tone: 'impact_driven',
    approach: 'RFP_ONLY',
    submission_url: 'https://leumi.co.il/corporate-responsibility',
    approach_note: 'פורטל CSR מסודר — אוריינות פיננסית ויזמות הם קו הגג.',
    typical_grant_range: '20,000–100,000 ₪',
  },
  {
    name: 'בנק מזרחי טפחות',
    name_en: 'Mizrahi Tefahot',
    website: 'https://mizrahi-tefahot.co.il',
    company_type: 'finance',
    csr_focus_tags: ['חינוך', 'קהילה', 'פריפריה', 'ספרדים ומזרחים'],
    donation_types: ['cash', 'volunteering'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לצוות CSR — דגש על זהות ועדות ופריפריה.',
    approach_note: 'בנק עם זיקה חזקה לקהילות מזרחיות — הצג חיבור לזהות ועדתית.',
    typical_grant_range: '10,000–60,000 ₪',
  },
  {
    name: 'הבנק הבינלאומי',
    name_en: 'First International Bank',
    website: 'https://fibi.co.il',
    company_type: 'finance',
    csr_focus_tags: ['חינוך', 'רווחה', 'קהילה'],
    donation_types: ['cash'],
    outreach_tone: 'formal',
    approach: 'OPEN',
    submission_instructions: 'פנייה פורמלית בכתב. כלול תקציב מפורט ומסמכי ניהול תקין.',
    approach_note: 'פנייה פורמלית — הכן תיק מסמכים מלא.',
  },
  {
    name: 'מנורה מבטחים',
    name_en: 'Menora Mivtachim',
    website: 'https://menora.co.il',
    company_type: 'finance',
    csr_focus_tags: ['בריאות', 'רווחה', 'קשישים', 'קהילה'],
    donation_types: ['cash', 'volunteering'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לצוות CSR. דגש על בריאות ורווחה — תואם לעולם הביטוח.',
    approach_note: 'ביטוח → בריאות ורווחה. קל להצדיק חיבור לליבת העסק.',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHARMA & HEALTH
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'טבע תעשיות פרמצבטיות',
    name_en: 'Teva Pharmaceuticals',
    website: 'https://tevapharm.com',
    company_type: 'pharma',
    csr_focus_tags: ['בריאות', 'נגישות לרפואה', 'קהילות מוחלשות', 'חינוך בריאות'],
    donation_types: ['cash', 'equipment', 'pro_bono'],
    outreach_tone: 'impact_driven',
    approach: 'RFP_ONLY',
    submission_url: 'https://tevapharm.com/sustainability',
    approach_note: 'בריאות ונגישות לרפואה בלבד — קולות קוראים שנתיים.',
    typical_grant_range: '50,000–300,000 ₪',
    red_flags: ['לא קשור לבריאות', 'ללא נגישות לאוכלוסייה מוחלשת'],
  },
  {
    name: 'כללית שירותי בריאות',
    name_en: "Clalit Health Services",
    website: 'https://clalit.co.il',
    company_type: 'pharma',
    csr_focus_tags: ['בריאות', 'מניעה', 'קהילה', 'קשישים', 'ילדים'],
    donation_types: ['pro_bono', 'cash'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לאגף הבריאות הקהילתית. הצג חיבור לשירותי מניעה.',
    approach_note: 'כללית — שותפות קהילתית מתקבלת. הדגש מניעה ובריאות קהילתית.',
  },
  {
    name: 'שניידר ילדים',
    name_en: "Schneider Children's",
    website: 'https://schneider.org.il',
    company_type: 'pharma',
    csr_focus_tags: ["בריאות ילדים", "מחקר רפואי", "נגישות"],
    donation_types: ['cash'],
    outreach_tone: 'formal',
    approach: 'RFP_ONLY',
    approach_note: 'CSR מבית החולים שניידר — בריאות ילדים בלבד.',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FOOD & RETAIL
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'שטראוס גרופ',
    name_en: 'Strauss Group',
    website: 'https://strauss-group.com',
    company_type: 'food',
    csr_focus_tags: ['בריאות', 'תזונה', 'ילדים', 'קהילה', 'סביבה'],
    donation_types: ['cash', 'equipment', 'volunteering'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לצוות ה-CSR של שטראוס. הדגש ילדים, תזונה ובריאות קהילתית.',
    approach_note: 'שטראוס = תזונה ובריאות. הצג חיבור ישיר לאוכלוסיית ילדים.',
    typical_grant_range: '20,000–120,000 ₪',
  },
  {
    name: 'אסם נסטלה',
    name_en: "Osem Nestlé",
    website: 'https://osem.co.il',
    company_type: 'food',
    csr_focus_tags: ['ילדים', 'תזונה', 'קהילה', 'בטחון תזונתי'],
    donation_types: ['cash', 'equipment'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לאחריות תאגידית אסם. הדגש ילדים ותזונה בקהילה.',
    approach_note: 'מזון — ילדים ותזונה קהילתית. תרומות מזון ותקציב.',
    typical_grant_range: '15,000–80,000 ₪',
  },
  {
    name: 'שופרסל',
    name_en: 'Shufersal',
    website: 'https://shufersal.co.il',
    company_type: 'retail',
    csr_focus_tags: ['קהילה', 'בטחון תזונתי', 'פריפריה', 'רווחה'],
    donation_types: ['cash', 'equipment', 'volunteering'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לצוות CSR. הדגש נגישות מזון ובטחון תזונתי.',
    approach_note: 'שופרסל — פריפריה ובטחון תזונתי. שותפות מסחרית ותרומות.',
  },
  {
    name: 'רמי לוי שיווק השקמה',
    name_en: 'Rami Levy',
    website: 'https://rami-levy.co.il',
    company_type: 'retail',
    csr_focus_tags: ['קהילה', 'פריפריה', 'מגזר ערבי', 'חרדים'],
    donation_types: ['cash', 'equipment'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה ישירות — חברה עם רגישות לפריפריה ולמגזרים.',
    approach_note: 'רמי לוי — גישה נגישה, דגש על קהילות שונות ופריפריה.',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TELECOM & MEDIA
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'בזק',
    name_en: 'Bezeq',
    website: 'https://bezeq.co.il',
    company_type: 'telecom',
    csr_focus_tags: ['נגישות דיגיטלית', 'קשישים', 'חינוך', 'קהילה', 'נגישות לאנשים עם מוגבלות'],
    donation_types: ['cash', 'equipment', 'pro_bono'],
    outreach_tone: 'impact_driven',
    approach: 'RFP_ONLY',
    submission_url: 'https://bezeq.co.il/corporate-responsibility',
    approach_note: 'נגישות דיגיטלית וחינוך — קולות קוראים. הדגש גישור פערים דיגיטליים.',
    typical_grant_range: '30,000–200,000 ₪',
  },
  {
    name: 'HOT תקשורת',
    name_en: 'HOT',
    website: 'https://hot.net.il',
    company_type: 'telecom',
    csr_focus_tags: ['תרבות', 'ספורט', 'קהילה', 'נגישות תוכן'],
    donation_types: ['cash', 'pro_bono'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לאגף CSR. הציע שיתוף תוכן ו-exposure בנוסף לכסף.',
    approach_note: 'HOT — תרבות ומדיה. שיתופי תוכן מוערכים לצד תמיכה כספית.',
  },
  {
    name: 'סלקום',
    name_en: 'Cellcom',
    website: 'https://cellcom.co.il',
    company_type: 'telecom',
    csr_focus_tags: ['נגישות דיגיטלית', 'קהילה', 'נוער', 'סביבה'],
    donation_types: ['cash', 'pro_bono'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לצוות CSR. הדגש נגישות דיגיטלית ונוער.',
    approach_note: 'סלקום — תוכניות נגישות דיגיטלית ונוער. פנייה ישירה מתקבלת.',
  },
  {
    name: 'פרטנר תקשורת',
    name_en: 'Partner Communications',
    website: 'https://partner.co.il',
    company_type: 'telecom',
    csr_focus_tags: ['חינוך', 'נגישות דיגיטלית', 'סביבה', 'קהילה'],
    donation_types: ['cash', 'volunteering'],
    outreach_tone: 'impact_driven',
    approach: 'OPEN',
    submission_instructions: 'פנה לצוות קיימות וCSR. הצג impact מדיד.',
    approach_note: 'פרטנר — דגש על קיימות וחינוך דיגיטלי.',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // INDUSTRIAL & ENERGY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'אלביט מערכות',
    name_en: 'Elbit Systems',
    website: 'https://elbit.co.il',
    company_type: 'industrial',
    csr_focus_tags: ['חינוך טכנולוגי', 'STEM', 'חיילים', 'פריפריה', 'ביטחון'],
    donation_types: ['cash', 'equipment', 'pro_bono'],
    outreach_tone: 'innovative',
    approach: 'OPEN',
    submission_instructions: 'פנה למחלקת CSR. הדגש STEM, פריפריה ותוכניות לחיילים.',
    approach_note: 'אלביט — STEM וחיילים. פנייה ישירה עם brief ממוקד.',
    typical_grant_range: '30,000–200,000 ₪',
    red_flags: ['ללא קשר לטכנולוגיה או ביטחון'],
  },
  {
    name: 'ICL — כיל',
    name_en: 'ICL Group',
    website: 'https://icl-group.com',
    company_type: 'industrial',
    csr_focus_tags: ['סביבה', 'קהילה', 'פריפריה', 'חינוך'],
    donation_types: ['cash', 'volunteering'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לאגף CSR. דגש על קהילות סביב האתרים (ים המלח, רמון, חיפה).',
    approach_note: 'ICL — קהילות בפריפריה. אזורי האתרים מקבלים עדיפות.',
    typical_grant_range: '20,000–150,000 ₪',
  },
  {
    name: 'נסטלה ישראל',
    name_en: 'Nestlé Israel',
    website: 'https://nestle.co.il',
    company_type: 'food',
    csr_focus_tags: ['ילדים', 'תזונה', 'קהילה', 'סביבה'],
    donation_types: ['cash', 'equipment'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לאחריות תאגידית. הדגש ילדים ותזונה בריאה.',
    approach_note: 'נסטלה — ילדים ותזונה בריאה.',
  },
  {
    name: 'חברת חשמל',
    name_en: 'Israel Electric Corp',
    website: 'https://iec.co.il',
    company_type: 'energy',
    csr_focus_tags: ['קהילה', 'סביבה', 'בטיחות', 'פריפריה'],
    donation_types: ['cash', 'volunteering'],
    outreach_tone: 'formal',
    approach: 'RFP_ONLY',
    approach_note: 'קולות קוראים דרך המחלקה לקשרי קהילה. תהליך פורמלי.',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // REAL ESTATE & CONSTRUCTION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'עזריאלי גרופ',
    name_en: 'Azrieli Group',
    website: 'https://azrieli.com',
    company_type: 'real_estate',
    csr_focus_tags: ['חינוך', 'תרבות', 'קהילה', 'נגישות'],
    donation_types: ['cash', 'pro_bono'],
    outreach_tone: 'formal',
    approach: 'REFERRAL_ONLY',
    submission_instructions: 'פנייה דרך הקרן (azrieli.org) — לא דרך החברה.',
    approach_note: 'הפנה לקרן עזריאלי (azrieli.org) ולא לחברה הנדל"נית.',
  },
  {
    name: 'אמות השקעות',
    name_en: 'Amot Investments',
    website: 'https://amot.co.il',
    company_type: 'real_estate',
    csr_focus_tags: ['קהילה', 'תרבות', 'חינוך'],
    donation_types: ['cash'],
    outreach_tone: 'formal',
    approach: 'OPEN',
    submission_instructions: 'פנה לצוות CSR. הדגש קהילות סמוכות לנכסים.',
    approach_note: 'נדל"ן מסחרי — קהילות בסמיכות לנכסים.',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // LAW, CONSULTING & SERVICES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'EY ישראל',
    name_en: 'EY Israel',
    website: 'https://ey.com/il',
    company_type: 'finance',
    csr_focus_tags: ['יזמות חברתית', 'חינוך', 'נשים', 'מגוון'],
    donation_types: ['pro_bono', 'volunteering', 'cash'],
    outreach_tone: 'impact_driven',
    approach: 'OPEN',
    submission_instructions: 'פנה לצוות CSR/Sustainability. הצע שיתוף מומחים בנוסף לכסף.',
    approach_note: 'EY — pro bono וייעוץ מוערכים. הצע שיתוף מומחים.',
  },
  {
    name: 'KPMG ישראל',
    name_en: 'KPMG Israel',
    website: 'https://kpmg.com/il',
    company_type: 'finance',
    csr_focus_tags: ['חינוך', 'יזמות', 'קהילה'],
    donation_types: ['pro_bono', 'cash'],
    outreach_tone: 'impact_driven',
    approach: 'OPEN',
    submission_instructions: 'פנה לצוות CSR. הדגש impact מדיד ו-ROI חברתי.',
    approach_note: 'KPMG — מייחסים חשיבות ל-impact measurement.',
  },
  {
    name: 'PWC ישראל',
    name_en: 'PwC Israel',
    website: 'https://pwc.com/il',
    company_type: 'finance',
    csr_focus_tags: ['חינוך', 'יזמות', 'מגוון'],
    donation_types: ['pro_bono', 'cash'],
    outreach_tone: 'impact_driven',
    approach: 'OPEN',
    submission_instructions: 'פנה לצוות Sustainability. הדגש diversity ו-impact data.',
    approach_note: 'PwC — מגוון ו-impact. הצג נתונים כמותיים.',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // INSURANCE & PENSION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'כלל ביטוח',
    name_en: 'Clal Insurance',
    website: 'https://clal.co.il',
    company_type: 'finance',
    csr_focus_tags: ['בריאות', 'רווחה', 'קשישים', 'קהילה'],
    donation_types: ['cash', 'volunteering'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לאגף CSR. חבר לנושאי ביטוח חיים ובריאות.',
    approach_note: 'כלל — בריאות ורווחה. הצג חיבור לאריכות ימים ואיכות חיים.',
  },
  {
    name: 'הראל ביטוח',
    name_en: 'Harel Insurance',
    website: 'https://harel-group.co.il',
    company_type: 'finance',
    csr_focus_tags: ['בריאות', 'קהילה', 'חינוך', 'רווחה'],
    donation_types: ['cash', 'volunteering'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לאחריות תאגידית הראל. הדגש בריאות וקהילה.',
    approach_note: 'הראל — בריאות וקהילה. פנייה ישירה עם brief מוכן.',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ADDITIONAL HIGH-IMPACT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'פוקס ווילשייר',
    name_en: 'Fox',
    website: 'https://fox.co.il',
    company_type: 'retail',
    csr_focus_tags: ['קהילה', 'נוער', 'ספורט'],
    donation_types: ['cash', 'equipment'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לצוות CSR. הדגש נוער וקהילה.',
    approach_note: 'פוקס — נוער וספורט קהילתי.',
  },
  {
    name: 'ישקר',
    name_en: 'Iscar',
    website: 'https://iscar.co.il',
    company_type: 'industrial',
    csr_focus_tags: ['חינוך', 'תעסוקה', 'פריפריה', 'STEM'],
    donation_types: ['cash', 'equipment', 'volunteering'],
    outreach_tone: 'community',
    approach: 'OPEN',
    submission_instructions: 'פנה לצוות CSR. הדגש תעסוקה ו-STEM בפריפריה.',
    approach_note: 'ישקר — תעסוקה ו-STEM בצפון הארץ.',
    typical_grant_range: '20,000–100,000 ₪',
  },
  {
    name: 'דיסקונט השקעות',
    name_en: 'Discount Investment',
    website: 'https://discount-investment.co.il',
    company_type: 'finance',
    csr_focus_tags: ['חינוך', 'תרבות', 'קהילה'],
    donation_types: ['cash'],
    outreach_tone: 'formal',
    approach: 'OPEN',
    submission_instructions: 'פנייה פורמלית. כלול budget, timeline ומדדי הצלחה.',
    approach_note: 'קונגלומרט — פנייה פורמלית עם נתונים מוצקים.',
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Validate an email before storing it.
 * Returns false for generic/spam addresses.
 */
export function isValidCSREmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.toLowerCase().trim();
  const genericPrefixes = [
    'info@', 'office@', 'contact@', 'mail@', 'admin@', 'support@',
    'webmaster@', 'noreply@', 'postmaster@', 'csr@', 'helpdesk@',
    'hello@', 'team@', 'general@', 'inquiry@',
  ];
  if (genericPrefixes.some(p => lower.startsWith(p))) return false;
  if (!lower.includes('@') || !lower.includes('.')) return false;
  if (lower.endsWith('.il') && lower.split('@')[0].length < 3) return false;
  return true;
}

/**
 * Find a company in the catalog by name (fuzzy, Hebrew or English).
 */
export function getCompanyCSRProfile(companyName: string): CompanyCSRProfile | null {
  if (!companyName) return null;
  const n = companyName.trim().toLowerCase();
  return ISRAELI_COMPANIES_CSR_CATALOG.find(c => {
    const heMatch = c.name.toLowerCase();
    const enMatch = (c.name_en || '').toLowerCase();
    return heMatch.includes(n) || n.includes(heMatch) ||
      (enMatch && (enMatch.includes(n) || n.includes(enMatch)));
  }) || null;
}

/**
 * Build a personalized outreach email opening line for a company.
 * Used by the submission engine and chat.
 */
export function buildCompanyOutreachOpener(
  profile: CompanyCSRProfile,
  orgName: string,
  orgFocus: string[],
): string {
  const sharedTags = orgFocus.filter(tag =>
    profile.csr_focus_tags.some(ct => ct.includes(tag) || tag.includes(ct))
  );

  const focusHint = sharedTags.length > 0
    ? `ראינו ש${profile.name} שמה דגש על ${sharedTags.slice(0, 2).join(' ו')}`
    : `כחלק מתוכנית האחריות התאגידית של ${profile.name}`;

  const contactLine = profile.contact_name
    ? `לכבוד ${profile.contact_name}${profile.contact_role ? `, ${profile.contact_role}` : ''},\n\n`
    : '';

  return `${contactLine}${focusHint}, ורצינו לשתף אתך בפעילות של ${orgName} — ארגון שעוסק ב${orgFocus.slice(0, 2).join(' ו')}.`;
}

/**
 * Build a Tavily search query to find the current CSR contact at a company.
 * Used by the live research flow in route.ts.
 */
export function buildContactSearchQuery(company: CompanyCSRProfile): string {
  const name = company.name_en || company.name;
  return `"${name}" OR "${company.name}" מנהל CSR אחריות תאגידית פנייה מענק עמותה ${new Date().getFullYear()}`;
}

/**
 * Format a company CSR profile as a concise block for AI context injection.
 */
export function formatCompanyContext(company: CompanyCSRProfile): string {
  const lines = [
    `חברה: ${company.name}${company.name_en ? ` (${company.name_en})` : ''}`,
    `אתר: ${company.website}`,
    `מיקוד CSR: ${company.csr_focus_tags.join(', ')}`,
    `סוגי תרומה: ${company.donation_types.join(', ')}`,
    `גישה: ${company.approach}`,
  ];
  if (company.typical_grant_range) lines.push(`טווח מענק: ${company.typical_grant_range}`);
  if (company.submission_url) lines.push(`פורטל הגשה: ${company.submission_url}`);
  if (company.submission_instructions) lines.push(`הוראות: ${company.submission_instructions}`);
  if (company.red_flags?.length) lines.push(`פסילה אוטומטית: ${company.red_flags.join(', ')}`);
  return lines.join('\n');
}

/**
 * Returns UX guidance: can we email this company directly?
 */
export function getCompanyOutreachGuidance(companyName: string): {
  canDirectApproach: boolean;
  message: string;
  profile?: CompanyCSRProfile;
} {
  const profile = getCompanyCSRProfile(companyName);
  if (!profile) {
    return {
      canDirectApproach: false,
      message: 'לא נמצא פרופיל CSR מאומת לחברה זו. חפש באתר הרשמי לפני פנייה.',
    };
  }
  if (profile.approach === 'RFP_ONLY') {
    return {
      canDirectApproach: false,
      message: profile.approach_note,
      profile,
    };
  }
  if (profile.approach === 'REFERRAL_ONLY') {
    return {
      canDirectApproach: false,
      message: profile.approach_note,
      profile,
    };
  }
  if (profile.approach === 'UNKNOWN') {
    return {
      canDirectApproach: false,
      message: `${profile.approach_note} — אמת לפני שליחה.`,
      profile,
    };
  }
  return {
    canDirectApproach: true,
    message: profile.approach_note,
    profile,
  };
}
