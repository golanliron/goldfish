// מסמכים שמוצגים למשתמש כ"חסרים" — ליבה חובה
export const REQUIRED_VAULT_DOCS: {
  key: string;
  label: string;
  pattern: RegExp;
  category: string;
  hint: string;
  ttl_months?: number;
}[] = [
  {
    key: 'nihul_takin',
    label: 'ניהול תקין',
    pattern: /ניהול תקין|nihul takin|proper management|רשם העמותות.*אישור|אישור.*ניהול/i,
    category: 'official',
    hint: 'אישור ניהול תקין מרשם העמותות (מתחדש שנתי)',
    ttl_months: 12,
  },
  {
    key: 'seif_46',
    label: 'סעיף 46',
    pattern: /סעיף.?46|אישור.?46|section.?46|46.*פקודת מס הכנסה|פקודת מס הכנסה.*46/i,
    category: 'official',
    hint: 'אישור לניכוי מס לתורמים (מתחדש כל 3 שנים)',
    ttl_months: 36,
  },
  {
    key: 'nikuy_mas',
    label: 'ניכוי מס במקור',
    pattern: /ניכוי מס במקור|ניכוי.?מס|withholding.?tax|אישור.?ניכוי/i,
    category: 'official',
    hint: 'אישור ניכוי מס במקור מרשות המסים',
    ttl_months: 12,
  },
  {
    key: 'teudat_rishum',
    label: 'תעודת רישום',
    pattern: /תעודת רישום|רישום עמותה|certificate of registration|אישור רישום|רשם העמותות.*מספר/i,
    category: 'official',
    hint: 'תעודת רישום מרשם העמותות (תמידית)',
  },
  {
    key: 'doch_kaspi',
    label: 'דוח כספי מבוקר',
    pattern: /דוח כספי|דוחות כספיים|כספי.*מבוקר|מבוקר.*כספי|רואה חשבון.*ביקורת|annual.*report|financial.*report|audited.*financial/i,
    category: 'budget',
    hint: 'דוח כספי מבוקר לשנת הפעילות האחרונה',
    ttl_months: 12,
  },
  {
    key: 'nihul_sfarim',
    label: 'ניהול ספרים',
    pattern: /ניהול ספרים|פנקסי חשבונות|bookkeeping|אישור.?ספרים/i,
    category: 'official',
    hint: 'אישור ניהול ספרים מרשות המסים',
    ttl_months: 12,
  },
  {
    key: 'vaad_mnahel',
    label: 'חברי ועד / פרוטוקול',
    pattern: /חברי ועד|ועד מנהל|פרוטוקול ועד|אסיפה כללית|board of directors|רשימת חברים/i,
    category: 'official',
    hint: 'רשימת חברי ועד מנהל / פרוטוקול אסיפה כללית',
    ttl_months: 12,
  },
  {
    key: 'baal_heshbon',
    label: 'אישור בעלות חשבון',
    pattern: /בעלות חשבון|אישור בנק|מכתב בנק|bank.*letter|bank.*account|אישור.*חשבון בנק/i,
    category: 'official',
    hint: 'אישור בנק על בעלות החשבון',
    ttl_months: 6,
  },
];

// מסמכים נוספים — מזוהים ומסווגים אוטומטית אך לא מוצגים כ"חסרים"
// גולדפיש מכיר אותם, לומד מהם, ומשתמש בהם בהגשות
export const EXTENDED_VAULT_DOCS: typeof REQUIRED_VAULT_DOCS = [
  {
    key: 'takanon',
    label: 'תקנון העמותה',
    pattern: /תקנון העמותה|תקנון.*עמותה|articles of association|bylaws/i,
    category: 'official',
    hint: 'תקנון העמותה המקורי / המעודכן',
  },
  {
    key: 'osek_murshe',
    label: 'אישור עוסק מורשה / פטור ממע"מ',
    pattern: /עוסק מורשה|פטור ממע"מ|פטור ממעמ|vat.*exempt|registered.*dealer/i,
    category: 'official',
    hint: 'אישור עוסק מורשה או פטור ממע"מ מרשות המסים',
    ttl_months: 12,
  },
  {
    key: 'doch_miluli',
    label: 'דוח מילולי שנתי',
    pattern: /דוח מילולי|דוח שנתי.*פעילות|דוח פעילות שנתי|annual.*activity.*report/i,
    category: 'impact',
    hint: 'דוח מילולי שנתי על פעילות הארגון',
    ttl_months: 12,
  },
  {
    key: 'bituach',
    label: 'ביטוח אחריות',
    pattern: /ביטוח אחריות|פוליסת ביטוח|liability.*insurance|insurance.*policy/i,
    category: 'official',
    hint: 'פוליסת ביטוח אחריות מקצועית / צד שלישי',
    ttl_months: 12,
  },
  {
    key: 'salary_report',
    label: 'דוח שכר / תקרת שכר',
    pattern: /תקרת שכר|דוח שכר|שכר מנכ"ל|salary.*cap|executive.*compensation/i,
    category: 'budget',
    hint: 'דוח שכר בכירים או הצהרת תקרת שכר',
    ttl_months: 12,
  },
  {
    key: 'key_people',
    label: 'רשימת בעלי תפקידים',
    pattern: /בעלי תפקידים|צוות הנהלה|key.*personnel|management.*team|organizational.*chart/i,
    category: 'identity',
    hint: 'רשימת בעלי תפקידים בכירים + פרטי קשר',
  },
  {
    key: 'w9_w8',
    label: 'W-9 / W-8BEN',
    pattern: /w-?9|w-?8ben|w8.*ben|tax.*identification.*number|tin.*form/i,
    category: 'official',
    hint: 'טופס מס אמריקאי לפדרציות ותורמים מארה"ב',
  },
  {
    key: 'impact_report',
    label: 'דוח אימפקט',
    pattern: /דוח אימפקט|דוח השפעה|impact.*report|theory.*of.*change|תיאוריית השינוי/i,
    category: 'impact',
    hint: 'דוח אימפקט / הערכת תוצאות',
    ttl_months: 12,
  },
  {
    key: 'strategic_plan',
    label: 'תוכנית אסטרטגית',
    pattern: /תוכנית אסטרטגית|תכנית עסקית|strategic.*plan|business.*plan/i,
    category: 'identity',
    hint: 'תוכנית אסטרטגית רב-שנתית',
    ttl_months: 36,
  },
  {
    key: 'recommendation_letters',
    label: 'מכתבי המלצה',
    pattern: /מכתב המלצה|מכתבי המלצה|letter.*of.*recommendation|letter.*of.*support/i,
    category: 'identity',
    hint: 'מכתבי המלצה מגורמים מקצועיים',
  },
];

// כל המסמכים ביחד — לזיהוי אוטומטי בהעלאה
export const ALL_VAULT_DOCS = [...REQUIRED_VAULT_DOCS, ...EXTENDED_VAULT_DOCS];
