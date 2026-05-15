/**
 * GET /api/documents/vault
 *
 * מחזיר:
 * - רשימת מסמכים קיימים של הארגון (+ תאריכי תוקף מה-metadata)
 * - רשימת מסמכי תשתית חסרים (gap analysis מול REQUIRED_VAULT_DOCS)
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';

// מסמכי תשתית קבועים — כל עמותה צריכה אותם
export const REQUIRED_VAULT_DOCS: {
  key: string;
  label: string;
  pattern: RegExp;
  category: string;
  hint: string;
  ttl_months?: number; // כמה חודשים בתוקף
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
    key: 'ba\'al_heshbon',
    label: 'אישור בעלות חשבון',
    pattern: /בעלות חשבון|אישור בנק|bank.*letter/i,
    category: 'official',
    hint: 'אישור בנק על בעלות החשבון',
    ttl_months: 6,
  },
];

function detectDocType(filename: string, parsedText?: string | null): string | null {
  const text = `${filename} ${parsedText?.slice(0, 200) || ''}`;
  for (const req of REQUIRED_VAULT_DOCS) {
    if (req.pattern.test(text)) return req.key;
  }
  return null;
}

export const GET = withAuth(async (_req, auth) => {
  const supabase = createAdminClient();

  const { data: docs, error } = await supabase
    .from('documents')
    .select('id, filename, category, file_type, uploaded_at, metadata, storage_path')
    .eq('org_id', auth.orgId)
    .order('uploaded_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const existingDocs = (docs || []).map(doc => {
    const expiry = (doc.metadata as Record<string, string>)?.expiry_date || null;
    const isExpired = expiry ? new Date(expiry) < new Date() : false;
    const expiresSoon = expiry
      ? (new Date(expiry).getTime() - Date.now()) / 86400000 < 30
      : false;

    return {
      id: doc.id,
      filename: doc.filename,
      category: doc.category,
      file_type: doc.file_type,
      uploaded_at: doc.uploaded_at,
      expiry_date: expiry,
      is_expired: isExpired,
      expires_soon: expiresSoon,
      vault_key: detectDocType(doc.filename),
      has_storage: !!doc.storage_path && !doc.storage_path.startsWith('http'),
    };
  });

  // Gap analysis — which required docs are missing or expired
  const coveredKeys = new Set(existingDocs.map(d => d.vault_key).filter(Boolean));
  const missingDocs = REQUIRED_VAULT_DOCS
    .filter(req => !coveredKeys.has(req.key))
    .map(req => ({
      key: req.key,
      label: req.label,
      hint: req.hint,
      category: req.category,
      ttl_months: req.ttl_months,
    }));

  // Expiring soon (within 30 days) or expired
  const expiringDocs = existingDocs.filter(d => d.is_expired || d.expires_soon);

  const vaultScore = Math.round(
    (coveredKeys.size / REQUIRED_VAULT_DOCS.length) * 100
  );

  return NextResponse.json({
    docs: existingDocs,
    missing: missingDocs,
    expiring: expiringDocs,
    vault_score: vaultScore,
    total_required: REQUIRED_VAULT_DOCS.length,
    total_covered: coveredKeys.size,
  });
});
