// ApolloProvider — company/people enrichment via Apollo.io API
// Status: STUB — implement when APOLLO_API_KEY is provisioned.
// Docs: https://apolloio.github.io/apollo-api-docs/

import type { DataProvider, ProviderMeta, RateLimitConfig } from './types';

export interface ApolloInput {
  /** Search by domain (preferred) or company name */
  domain?: string;
  companyName?: string;
  /** Optional: enrich a specific person */
  email?: string;
}

export interface ApolloResult {
  companyName: string;
  domain: string;
  industry?: string;
  employeeCount?: number;
  annualRevenue?: number;
  linkedinUrl?: string;
  description?: string;
  technologies?: string[];
  /** CSR / philanthropy signals if available */
  csrSignals?: string[];
}

export class ApolloProvider implements DataProvider<ApolloInput, ApolloResult | null> {
  readonly meta: ProviderMeta = {
    id: 'apollo',
    name: 'Apollo.io',
    category: 'enrichment',
    description: 'Company and people data enrichment — revenues, industry, contacts',
    baseUrl: 'https://api.apollo.io/v1',
    docsUrl: 'https://apolloio.github.io/apollo-api-docs/',
  };

  // Apollo free tier: 50 enrichments / month  →  ~1.6/day. Conservative daily cap.
  readonly rateLimit: RateLimitConfig = {
    requestsPerWindow: 50,
    windowMs: 24 * 60 * 60_000,  // 24 hours
    maxConcurrent: 2,
    minDelayMs: 500,
  };

  async execute(input: ApolloInput, _signal?: AbortSignal): Promise<ApolloResult | null> {
    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) {
      // Graceful degradation — return null instead of throwing
      console.warn('[ApolloProvider] APOLLO_API_KEY not set — skipping enrichment');
      return null;
    }

    // TODO: implement when key is provisioned
    // Suggested endpoint: POST https://api.apollo.io/v1/organizations/enrich
    // Body: { api_key, domain } or { api_key, name }
    throw new Error('[ApolloProvider] Not yet implemented — set APOLLO_API_KEY and complete execute()');
  }

  async healthCheck(): Promise<boolean> {
    return !!process.env.APOLLO_API_KEY;
  }

  cacheKey(input: ApolloInput): string {
    return `apollo:${input.domain ?? input.companyName ?? input.email ?? 'unknown'}`;
  }
}
