// iCountProvider — Israeli accounting SaaS (icount.co.il)
// Status: STUB — implement when org connects iCount credentials.
// Used to pull: revenue data, donation receipts (46/קבלה), expense reports.
// Docs: https://icount.co.il/api (Hebrew)

import type { DataProvider, ProviderMeta, RateLimitConfig } from './types';

export interface ICountInput {
  action:
    | 'get_income'       // הכנסות בתקופה
    | 'get_expenses'     // הוצאות בתקופה
    | 'get_receipts'     // קבלות תרומה (46)
    | 'get_balance';     // יתרות
  fromDate?: string;   // YYYY-MM-DD
  toDate?: string;
  /** iCount company ID (cid) */
  cid: string;
}

export interface ICountRecord {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: 'ILS' | 'USD' | 'EUR';
  category?: string;
  /** Contact / donor name for receipts */
  contact?: string;
}

export interface ICountResult {
  records: ICountRecord[];
  totalAmount: number;
  currency: string;
  periodFrom?: string;
  periodTo?: string;
}

export class ICountProvider implements DataProvider<ICountInput, ICountResult> {
  readonly meta: ProviderMeta = {
    id: 'icount',
    name: 'iCount',
    category: 'accounting',
    description: 'Israeli accounting — donations, receipts, income & expense reports',
    baseUrl: 'https://icount.co.il/api',
    docsUrl: 'https://icount.co.il/api',
  };

  // iCount API limits are generous but undocumented — conservative default
  readonly rateLimit: RateLimitConfig = {
    requestsPerWindow: 60,
    windowMs: 60_000,
    maxConcurrent: 2,
    minDelayMs: 300,
  };

  async execute(input: ICountInput, _signal?: AbortSignal): Promise<ICountResult> {
    const user = process.env.ICOUNT_USER;
    const pass = process.env.ICOUNT_PASS;

    if (!user || !pass) {
      console.warn('[ICountProvider] ICOUNT_USER / ICOUNT_PASS not set — skipping');
      return { records: [], totalAmount: 0, currency: 'ILS' };
    }

    // TODO: implement when credentials are provisioned
    // Step 1: POST https://icount.co.il/api/login  → session token
    // Step 2: POST https://icount.co.il/api/doc/doclist  (action-specific)
    // Step 3: Parse response into ICountRecord[]
    throw new Error('[ICountProvider] Not yet implemented — set ICOUNT_USER / ICOUNT_PASS and complete execute()');
  }

  async healthCheck(): Promise<boolean> {
    return !!(process.env.ICOUNT_USER && process.env.ICOUNT_PASS);
  }

  cacheKey(input: ICountInput): string {
    return `icount:${input.cid}:${input.action}:${input.fromDate ?? ''}:${input.toDate ?? ''}`;
  }
}
