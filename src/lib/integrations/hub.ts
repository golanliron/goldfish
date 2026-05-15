// Integration Hub — Orchestrator
// Manages connect/sync/disconnect lifecycle for any registered integration.
// All operations are org-scoped and config is always encrypted before storage.

import { getIntegration } from './registry';
import type { IntegrationRecord, IntegrationConnectionResult, IntegrationSyncResult, FetchOptions } from './types';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Encryption helpers (AES-GCM, key from env) ──────────────────────────────

async function getKey(): Promise<CryptoKey> {
  const raw = Buffer.from(process.env.INTEGRATION_ENCRYPTION_KEY ?? '', 'base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptConfig(config: unknown): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(config));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array([...iv, ...new Uint8Array(cipher)]);
  return Buffer.from(combined).toString('base64');
}

async function decryptConfig<T>(blob: string): Promise<T> {
  const key = await getKey();
  const combined = Buffer.from(blob, 'base64');
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function connectIntegration(
  orgId: string,
  integrationId: string,
  config: unknown
): Promise<IntegrationConnectionResult> {
  const integration = getIntegration(integrationId);
  if (!integration) return { success: false, status: 'error', error: `Unknown integration: ${integrationId}` };

  const result = await integration.testConnection(config);
  if (!result.success) return result;

  const configEncrypted = await encryptConfig(config);
  await supabase.from('integrations').upsert(
    {
      org_id: orgId,
      integration_id: integrationId,
      status: 'connected',
      config_encrypted: configEncrypted,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,integration_id' }
  );

  return result;
}

export async function syncIntegration(
  orgId: string,
  integrationId: string,
  options?: FetchOptions
): Promise<IntegrationSyncResult> {
  const integration = getIntegration(integrationId);
  if (!integration) return { success: false, records: [], count: 0, syncedAt: new Date().toISOString(), error: `Unknown integration: ${integrationId}` };

  const { data: record } = await supabase
    .from('integrations')
    .select('config_encrypted')
    .eq('org_id', orgId)
    .eq('integration_id', integrationId)
    .single();

  if (!record) return { success: false, records: [], count: 0, syncedAt: new Date().toISOString(), error: 'Integration not connected' };

  const config = await decryptConfig(record.config_encrypted);
  const result = await integration.fetchData(config, options);

  await supabase
    .from('integrations')
    .update({
      last_sync_at: result.syncedAt,
      last_error: result.error ?? null,
      status: result.success ? 'connected' : 'error',
      updated_at: new Date().toISOString(),
    })
    .eq('org_id', orgId)
    .eq('integration_id', integrationId);

  return result;
}

export async function disconnectIntegration(orgId: string, integrationId: string): Promise<void> {
  await supabase
    .from('integrations')
    .update({ status: 'disconnected', config_encrypted: '', updated_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('integration_id', integrationId);
}

export async function getIntegrationStatus(orgId: string): Promise<IntegrationRecord[]> {
  const { data } = await supabase
    .from('integrations')
    .select('id, org_id, integration_id, status, last_sync_at, last_error, created_at, updated_at')
    .eq('org_id', orgId);
  return (data ?? []) as IntegrationRecord[];
}
