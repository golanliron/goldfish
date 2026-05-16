/**
 * POST /api/documents/backfill-vault
 *
 * Scans all existing documents for this org and detects vault_key
 * from filename + parsed_text content, then writes it to metadata.
 * Also upgrades category to 'official' for matched docs.
 *
 * Safe to run multiple times (idempotent).
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import { ALL_VAULT_DOCS } from '@/lib/vault-docs';

function detectVaultKey(filename: string, parsedText?: string | null): string | null {
  const combined = `${filename} ${parsedText?.slice(0, 5000) || ''}`;
  for (const req of ALL_VAULT_DOCS) {
    if (req.pattern.test(combined)) return req.key;
  }
  return null;
}

export const maxDuration = 120;

export const POST = withAuth(async (_req, auth) => {
  const supabase = createAdminClient();

  // Fetch all docs for this org that are ready
  const { data: docs, error } = await supabase
    .from('documents')
    .select('id, filename, category, metadata, parsed_text')
    .eq('org_id', auth.orgId)
    .in('status', ['ready', 'processing']);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!docs?.length) return NextResponse.json({ updated: 0, total: 0 });

  const results: { id: string; filename: string; vault_key: string }[] = [];

  for (const doc of docs) {
    const meta = (doc.metadata as Record<string, string>) || {};
    // Skip if vault_key already stored
    if (meta.vault_key) continue;

    const parsedText = (doc as unknown as { parsed_text?: string | null }).parsed_text ?? null;
    const vaultKey = detectVaultKey(doc.filename, parsedText);
    if (!vaultKey) continue;

    // Update metadata with vault_key and upgrade category to 'official'
    await supabase
      .from('documents')
      .update({
        metadata: { ...meta, vault_key: vaultKey },
        category: 'official',
      })
      .eq('id', doc.id);

    results.push({ id: doc.id, filename: doc.filename, vault_key: vaultKey });
  }

  return NextResponse.json({
    updated: results.length,
    total: docs.length,
    skipped: docs.length - results.length,
    classified: results,
  });
});
