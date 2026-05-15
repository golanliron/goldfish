// TavilyProvider — wraps src/lib/ai/web-search.ts under the DataProvider interface
// Rate limit: 100 req / 60s (Tavily free tier)
// BusinessTab / OpportunitiesTab should call Manager.call('tavily', ...) — never import this directly.

import type { DataProvider, ProviderMeta, RateLimitConfig } from './types';

export interface TavilyInput {
  query: string;
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeDomains?: string[];
  topic?: 'general' | 'news';
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export class TavilyProvider implements DataProvider<TavilyInput, TavilyResult[]> {
  readonly meta: ProviderMeta = {
    id: 'tavily',
    name: 'Tavily Search',
    category: 'search',
    description: 'Real-time web search for grants, funders, and sector intelligence',
    baseUrl: 'https://api.tavily.com',
    docsUrl: 'https://docs.tavily.com',
  };

  readonly rateLimit: RateLimitConfig = {
    requestsPerWindow: 100,
    windowMs: 60_000,    // 1 minute
    maxConcurrent: 3,
    minDelayMs: 200,
  };

  async execute(input: TavilyInput, signal?: AbortSignal): Promise<TavilyResult[]> {
    // Dynamic import keeps this module edge-safe when Tavily is not installed
    const { tavily } = await import('@tavily/core');

    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error('[TavilyProvider] TAVILY_API_KEY not set');

    const client = tavily({ apiKey });

    const response = await client.search(input.query, {
      maxResults: input.maxResults ?? 5,
      searchDepth: input.searchDepth ?? 'basic',
      includeDomains: input.includeDomains,
      topic: input.topic ?? 'general',
    });

    // Honour abort signal if the underlying SDK fires after we already got data
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    return (response.results ?? []).map(r => ({
      title: r.title ?? '',
      url: r.url ?? '',
      content: r.content ?? '',
      score: r.score ?? 0,
    }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const results = await this.execute({ query: 'test', maxResults: 1 });
      return Array.isArray(results);
    } catch {
      return false;
    }
  }

  cacheKey(input: TavilyInput): string {
    const domains = input.includeDomains?.join(',') ?? '';
    return `tavily:${input.query}:${input.maxResults ?? 5}:${input.searchDepth ?? 'basic'}:${domains}`;
  }
}
