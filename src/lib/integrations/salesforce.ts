// Integration Hub — Salesforce (NPSP / Nonprofit Success Pack)
// Focused on donor records and donation history

import type {
  ExternalIntegration,
  IntegrationMeta,
  IntegrationConnectionResult,
  IntegrationSyncResult,
  FetchOptions,
} from './types';

export interface SalesforceConfig {
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;    // e.g. https://myorg.salesforce.com
  expiresAt: string;
}

export interface SalesforceDonor {
  Id: string;
  Name: string;
  Email: string;
  Phone: string;
  npo02__TotalOppAmount__c: number;    // NPSP lifetime giving
  npo02__LastCloseDate__c: string;
  RecordType: { Name: string };
}

const META: IntegrationMeta = {
  id: 'salesforce',
  name: 'Salesforce NPSP',
  category: 'crm',
  description: 'סנכרון תורמים ותרומות מ-Salesforce Nonprofit Success Pack',
  logoUrl: '/integrations/salesforce-logo.png',
  docsUrl: 'https://developer.salesforce.com',
  requiresOAuth: true,
};

export class SalesforceIntegration implements ExternalIntegration<SalesforceConfig, SalesforceDonor> {
  meta = META;

  private async soql<T>(config: SalesforceConfig, query: string): Promise<{ records: T[]; totalSize: number }> {
    const url = `${config.instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.accessToken}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Salesforce ${res.status}: ${await res.text()}`);
    return res.json() as Promise<{ records: T[]; totalSize: number }>;
  }

  async testConnection(config: SalesforceConfig): Promise<IntegrationConnectionResult> {
    try {
      await this.soql(config, 'SELECT Id FROM User LIMIT 1');
      return { success: true, status: 'connected' };
    } catch (err) {
      return { success: false, status: 'error', error: String(err) };
    }
  }

  async fetchData(config: SalesforceConfig, options?: FetchOptions): Promise<IntegrationSyncResult<SalesforceDonor>> {
    try {
      const limit = options?.limit ?? 200;
      const sinceClause = options?.since
        ? ` WHERE SystemModstamp > ${options.since}`
        : '';

      const query = `
        SELECT Id, Name, Email, Phone,
               npo02__TotalOppAmount__c, npo02__LastCloseDate__c,
               RecordType.Name
        FROM Contact${sinceClause}
        ORDER BY npo02__TotalOppAmount__c DESC NULLS LAST
        LIMIT ${limit}
      `;

      const result = await this.soql<SalesforceDonor>(config, query);
      return {
        success: true,
        records: result.records,
        count: result.records.length,
        syncedAt: new Date().toISOString(),
      };
    } catch (err) {
      return { success: false, records: [], count: 0, syncedAt: new Date().toISOString(), error: String(err) };
    }
  }

  getAuthUrl(redirectUri: string, state?: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.SF_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      scope: 'api refresh_token',
      ...(state ? { state } : {}),
    });
    return `https://login.salesforce.com/services/oauth2/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<SalesforceConfig> {
    const res = await fetch('https://login.salesforce.com/services/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.SF_CLIENT_ID ?? '',
        client_secret: process.env.SF_CLIENT_SECRET ?? '',
        code,
        redirect_uri: redirectUri,
      }),
    });
    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      instance_url: string;
    };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      instanceUrl: data.instance_url,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // SF tokens ~ 2h
    };
  }

  async refreshToken(config: SalesforceConfig): Promise<SalesforceConfig> {
    const res = await fetch('https://login.salesforce.com/services/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.SF_CLIENT_ID ?? '',
        client_secret: process.env.SF_CLIENT_SECRET ?? '',
        refresh_token: config.refreshToken,
      }),
    });
    const data = await res.json() as { access_token: string; instance_url: string };
    return {
      ...config,
      accessToken: data.access_token,
      instanceUrl: data.instance_url,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    };
  }
}
