// Integration Hub — Core Types
// Every external integration implements ExternalIntegration<TConfig, TData>

export type IntegrationCategory =
  | 'crm'
  | 'accounting'
  | 'project_management'
  | 'communication'
  | 'fundraising'
  | 'analytics'
  | 'storage'
  | 'custom';

export type IntegrationStatus = 'connected' | 'disconnected' | 'error' | 'pending';

export interface IntegrationMeta {
  id: string;               // unique slug, e.g. 'quickbooks', 'salesforce'
  name: string;             // display name
  category: IntegrationCategory;
  description: string;
  logoUrl?: string;
  docsUrl?: string;
  requiresOAuth: boolean;
}

export interface IntegrationConnectionResult {
  success: boolean;
  status: IntegrationStatus;
  error?: string;
  connectedAt?: string;
}

export interface IntegrationSyncResult<T = unknown> {
  success: boolean;
  records: T[];
  count: number;
  syncedAt: string;
  error?: string;
}

// The single Interface every integration must implement
export interface ExternalIntegration<TConfig = Record<string, unknown>, TData = unknown> {
  meta: IntegrationMeta;

  // Test whether the stored credentials are valid
  testConnection(config: TConfig): Promise<IntegrationConnectionResult>;

  // Pull data from the external system
  fetchData(config: TConfig, options?: FetchOptions): Promise<IntegrationSyncResult<TData>>;

  // Push data to the external system (optional — read-only integrations may omit)
  pushData?(config: TConfig, payload: Partial<TData>[]): Promise<{ success: boolean; pushed: number; error?: string }>;

  // OAuth flow helpers (only required when meta.requiresOAuth = true)
  getAuthUrl?(redirectUri: string, state?: string): string;
  exchangeCode?(code: string, redirectUri: string): Promise<TConfig>;
  refreshToken?(config: TConfig): Promise<TConfig>;
}

export interface FetchOptions {
  since?: string;       // ISO date — fetch only records updated after this date
  limit?: number;
  page?: number;
  filters?: Record<string, unknown>;
}

// Registry entry stored in Supabase (integrations table)
export interface IntegrationRecord {
  id: string;
  org_id: string;
  integration_id: string;   // matches IntegrationMeta.id
  status: IntegrationStatus;
  config_encrypted: string; // encrypted JSON blob
  last_sync_at?: string;
  last_error?: string;
  created_at: string;
  updated_at: string;
}
