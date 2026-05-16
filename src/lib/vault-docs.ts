// מסמכי תשתית קבועים — כל עמותה צריכה אותם
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
