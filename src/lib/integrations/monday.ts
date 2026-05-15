// Integration Hub — Monday.com
// Wraps the existing monday.ts client into the standard Interface

import type {
  ExternalIntegration,
  IntegrationMeta,
  IntegrationConnectionResult,
  IntegrationSyncResult,
  FetchOptions,
} from './types';
import { mondayQuery, getMondayStatus } from '../monday';

export interface MondayConfig {
  accessToken: string;
  accountId?: string;
}

export interface MondayItem {
  id: string;
  name: string;
  board_id: string;
  column_values: { id: string; text: string }[];
  updated_at: string;
}

const META: IntegrationMeta = {
  id: 'monday',
  name: 'Monday.com',
  category: 'project_management',
  description: 'סנכרון לוחות ופריטים מ-Monday.com',
  logoUrl: '/integrations/monday-logo.png',
  docsUrl: 'https://developer.monday.com',
  requiresOAuth: true,
};

export class MondayIntegration implements ExternalIntegration<MondayConfig, MondayItem> {
  meta = META;

  async testConnection(_config: MondayConfig): Promise<IntegrationConnectionResult> {
    const status = await getMondayStatus();
    return {
      success: status.connected,
      status: status.connected ? 'connected' : 'disconnected',
      connectedAt: status.connected_at,
    };
  }

  async fetchData(_config: MondayConfig, options?: FetchOptions): Promise<IntegrationSyncResult<MondayItem>> {
    const limit = options?.limit ?? 50;
    const query = `
      query {
        boards(limit: 10) {
          items_page(limit: ${limit}) {
            items {
              id
              name
              board { id }
              column_values { id text }
              updated_at
            }
          }
        }
      }
    `;

    try {
      const data = await mondayQuery<{ boards: { items_page: { items: MondayItem[] } }[] }>(query);
      const records = data.boards.flatMap(b => b.items_page.items);
      return {
        success: true,
        records,
        count: records.length,
        syncedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        records: [],
        count: 0,
        syncedAt: new Date().toISOString(),
        error: String(err),
      };
    }
  }

  getAuthUrl(redirectUri: string, state?: string): string {
    const params = new URLSearchParams({
      client_id: process.env.MONDAY_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      ...(state ? { state } : {}),
    });
    return `https://auth.monday.com/oauth2/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<MondayConfig> {
    const res = await fetch('https://auth.monday.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.MONDAY_CLIENT_ID,
        client_secret: process.env.MONDAY_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const data = await res.json() as { access_token: string; account_id?: string };
    return { accessToken: data.access_token, accountId: data.account_id };
  }
}
