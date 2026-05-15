// Integration Hub — QuickBooks Online
// Template for OAuth2 accounting integration

import type {
  ExternalIntegration,
  IntegrationMeta,
  IntegrationConnectionResult,
  IntegrationSyncResult,
  FetchOptions,
} from './types';

export interface QuickBooksConfig {
  accessToken: string;
  refreshToken: string;
  realmId: string;       // company ID
  expiresAt: string;     // ISO timestamp
}

export interface QuickBooksVendor {
  Id: string;
  DisplayName: string;
  Balance: number;
  CurrencyRef: { value: string };
  Active: boolean;
}

const META: IntegrationMeta = {
  id: 'quickbooks',
  name: 'QuickBooks Online',
  category: 'accounting',
  description: 'סנכרון ספקים, הוצאות וקבלות מ-QuickBooks',
  logoUrl: '/integrations/quickbooks-logo.png',
  docsUrl: 'https://developer.intuit.com',
  requiresOAuth: true,
};

const QB_BASE = 'https://quickbooks.api.intuit.com/v3/company';

export class QuickBooksIntegration implements ExternalIntegration<QuickBooksConfig, QuickBooksVendor> {
  meta = META;

  private async request<T>(config: QuickBooksConfig, path: string): Promise<T> {
    const url = `${QB_BASE}/${config.realmId}${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`QuickBooks ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async testConnection(config: QuickBooksConfig): Promise<IntegrationConnectionResult> {
    try {
      await this.request(config, '/companyinfo/' + config.realmId);
      return { success: true, status: 'connected' };
    } catch (err) {
      return { success: false, status: 'error', error: String(err) };
    }
  }

  async fetchData(config: QuickBooksConfig, options?: FetchOptions): Promise<IntegrationSyncResult<QuickBooksVendor>> {
    try {
      const limit = options?.limit ?? 100;
      const since = options?.since ? ` WHERE MetaData.LastUpdatedTime > '${options.since}'` : '';
      const query = encodeURIComponent(`SELECT * FROM Vendor${since} MAXRESULTS ${limit}`);

      const data = await this.request<{ QueryResponse: { Vendor: QuickBooksVendor[] } }>(
        config,
        `/query?query=${query}`
      );
      const records = data.QueryResponse.Vendor ?? [];
      return { success: true, records, count: records.length, syncedAt: new Date().toISOString() };
    } catch (err) {
      return { success: false, records: [], count: 0, syncedAt: new Date().toISOString(), error: String(err) };
    }
  }

  getAuthUrl(redirectUri: string, state?: string): string {
    const params = new URLSearchParams({
      client_id: process.env.QB_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      ...(state ? { state } : {}),
    });
    return `https://appcenter.intuit.com/connect/oauth2?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<QuickBooksConfig> {
    const credentials = Buffer.from(
      `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`
    ).toString('base64');

    const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      realmId: string;
    };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      realmId: data.realmId,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
  }

  async refreshToken(config: QuickBooksConfig): Promise<QuickBooksConfig> {
    const credentials = Buffer.from(
      `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`
    ).toString('base64');

    const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: config.refreshToken }),
    });
    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    return {
      ...config,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };
  }
}
