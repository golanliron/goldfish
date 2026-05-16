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
import { geminiCall } from '@/lib/ai/gemini';
import { ALL_VAULT_DOCS } from '@/lib/vault-docs';

// Regex-based fast path — used when text is clean and filename is descriptive
function detectVaultKeyRegex(filename: string, parsedText?: string | null): string | null {
  const combined = `${filename} ${parsedText?.slice(0, 5000) || ''}`;
  for (const req of ALL_VAULT_DOCS) {
    if (req.pattern.test(combined)) return req.key;
  }
  return null;
}

// AI-based classifier — used when regex fails (scanned/noisy PDFs, generic filenames)
const VAULT_KEYS_LIST = ALL_VAULT_DOCS.map(d => `${d.key} — ${d.label}`).join('\n');

async function detectVaultKeyAI(filename: string, parsedText: string | null): Promise<string | null> {
  const snippet = parsedText?.trim().slice(0, 600) || '';
  if (!snippet && filename.length < 5) return null;

  const prompt = `אתה מומחה לניתוח מסמכים של עמותות ישראליות.

שם הקובץ: "${filename}"
תחילת תוכן המסמך:
---
${snippet || '(אין תוכן זמין — הסתמך על שם הקובץ בלבד)'}
---

מהרשימה הבאה, החזר את ה-key המתאים ביותר לסוג המסמך:
${VAULT_KEYS_LIST}

כללים:
- החזר key בלבד — מחרוזת אחת, ללא הסברים
- אם המסמך לא תואם אף key ברשימה — החזר null
- תן עדיפות לתוכן על פני שם הקובץ`;

  try {
    const raw = await geminiCall(prompt, 30, 0);
    const key = raw.trim().replace(/['"]/g, '').toLowerCase();
    // Validate the key exists in our list
    if (ALL_VAULT_DOCS.some(d => d.key === key)) return key;
    return null;
  } catch {
    return null;
  }
}

async function detectVaultKey(filename: string, parsedText?: string | null): Promise<string | null> {
  // Fast path: regex (instant, no API cost)
  const regexResult = detectVaultKeyRegex(filename, parsedText);
  if (regexResult) return regexResult;

  // Slow path: AI classifier (for scanned/noisy/generic docs)
  return detectVaultKeyAI(filename, parsedText ?? null);
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

  const results: { id: string; filename: string; vault_key: string; method: 'regex' | 'ai' }[] = [];
  let aiCalls = 0;

  for (const doc of docs) {
    const meta = (doc.metadata as Record<string, string>) || {};
    // Skip if vault_key already stored
    if (meta.vault_key) continue;

    const parsedText = (doc as unknown as { parsed_text?: string | null }).parsed_text ?? null;

    // Try regex first (free, instant)
    const regexKey = detectVaultKeyRegex(doc.filename, parsedText);
    let vaultKey: string | null = regexKey;
    let method: 'regex' | 'ai' = 'regex';

    // Fallback to AI if regex missed it
    if (!vaultKey) {
      vaultKey = await detectVaultKeyAI(doc.filename, parsedText);
      method = 'ai';
      aiCalls++;
    }

    if (!vaultKey) continue;

    // Get the category from the vault doc definition
    const vaultDoc = ALL_VAULT_DOCS.find(d => d.key === vaultKey);
    const newCategory = vaultDoc?.category || 'official';

    await supabase
      .from('documents')
      .update({
        metadata: { ...meta, vault_key: vaultKey, vault_classified_by: method },
        category: newCategory,
      })
      .eq('id', doc.id);

    results.push({ id: doc.id, filename: doc.filename, vault_key: vaultKey, method });
  }

  return NextResponse.json({
    updated: results.length,
    total: docs.length,
    skipped: docs.length - results.length,
    ai_calls: aiCalls,
    classified: results,
  });
});
