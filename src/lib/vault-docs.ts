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
    pattern: /ניהול תקין/i,
    category: 'official',
    hint: 'אישור ניהול תקין מרשם העמותות (מתחדש שנתי)',
    ttl_months: 12,
  },
  {
    key: 'seif_46',
    label: 'סעיף 46',
    pattern: /סעיף.?46|אישור.?46|section.?46/i,
    category: 'official',
    hint: 'אישור לניכוי מס לתורמים (מתחדש כל 3 שנים)',
    ttl_months: 36,
  },
  {
    key: 'nikuy_mas',
    label: 'ניכוי מס במקור',
    pattern: /ניכוי מס/i,
    category: 'official',
    hint: 'אישור ניכוי מס במקור מרשות המסים',
    ttl_months: 12,
  },
  {
    key: 'teudат_rіshum',
    label: 'תעודת רישום',
    pattern: /תעודת רישום|רישום עמותה/i,
    category: 'official',
    hint: 'תעודת רישום מרשם העמותות (תמידית)',
  },
  {
    key: 'doch_kaspі',
    label: 'דוח כספי מבוקר',
    pattern: /דוח כספי|דוחות כספיים|כספי.*מבוקר|annual.*report|financial.*report/i,
    category: 'budget',
    hint: 'דוח כספי מבוקר לשנת הפעילות האחרונה',
    ttl_months: 12,
  },
  {
    key: 'nihul_sfarim',
    label: 'ניהול ספרים',
    pattern: /ניהול ספרים/i,
    category: 'official',
    hint: 'אישור ניהול ספרים מרשות המסים',
    ttl_months: 12,
  },
  {
    key: 'vaad_mnahel',
    label: 'חברי ועד / פרוטוקול',
    pattern: /חברי ועד|ועד מנהל|פרוטוקול ועד/i,
    category: 'official',
    hint: 'רשימת חברי ועד מנהל / פרוטוקול אסיפה כללית',
    ttl_months: 12,
  },
  {
    key: "ba'al_heshbon",
    label: 'אישור בעלות חשבון',
    pattern: /בעלות חשבון|אישור בנק|bank.*letter/i,
    category: 'official',
    hint: 'אישור בנק על בעלות החשבון',
    ttl_months: 6,
  },
];
