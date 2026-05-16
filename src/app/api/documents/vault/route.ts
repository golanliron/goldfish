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
import { REQUIRED_VAULT_DOCS, ALL_VAULT_DOCS } from '@/lib/vault-docs';

export { REQUIRED_VAULT_DOCS };

function detectDocType(filename: string, parsedText?: string | null): string | null {
  // Search across ALL known doc types — required + extended
  const text = `${filename} ${parsedText?.slice(0, 5000) || ''}`;
  for (const req of ALL_VAULT_DOCS) {
    if (req.pattern.test(text)) return req.key;
  }
  return null;
}

export const GET = withAuth(async (_req, auth) => {
  const supabase = createAdminClient();

  const { data: docs, error } = await supabase
    .from('documents')
    .select('id, filename, category, file_type, uploaded_at, metadata, storage_path, parsed_text, status')
    .eq('org_id', auth.orgId)
    .in('status', ['ready', 'processing'])
    .order('uploaded_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const existingDocs = (docs || []).map(doc => {
    const expiry = (doc.metadata as Record<string, string>)?.expiry_date || null;
    const isExpired = expiry ? new Date(expiry) < new Date() : false;
    const expiresSoon = expiry
      ? (new Date(expiry).getTime() - Date.now()) / 86400000 < 30
      : false;

    // Prefer vault_key already stored in metadata (set at upload time),
    // then fall back to pattern-matching filename + parsed_text content
    const meta = (doc.metadata as Record<string, string>) || {};
    const storedVaultKey = meta.vault_key || null;
    const parsedText = (doc as unknown as { parsed_text?: string | null }).parsed_text ?? null;
    const detectedVaultKey = storedVaultKey
      ?? detectDocType(doc.filename, parsedText);

    return {
      id: doc.id,
      filename: doc.filename,
      category: doc.category,
      file_type: doc.file_type,
      uploaded_at: doc.uploaded_at,
      expiry_date: expiry,
      is_expired: isExpired,
      expires_soon: expiresSoon,
      vault_key: detectedVaultKey,
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
