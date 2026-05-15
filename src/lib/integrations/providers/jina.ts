// JinaProvider — URL content fetcher via r.jina.ai
// Used for reading grant pages, funder websites, gov documents.
// Rate limit: 200 req / 60s (Jina free tier generous, but we're conservative)

import type { DataProvider, ProviderMeta, RateLimitConfig } from './types';

export interface JinaInput {
  url: string;
  /** Max chars to return (default: 15_000) */
  maxChars?: number;
}

export interface JinaResult {
  url: string;
  content: string;
  /** true if content was extracted (false = empty / blocked) */
  readable: boolean;
}

export class JinaProvider implements DataProvider<JinaInput, JinaResult> {
  readonly meta: ProviderMeta = {
    id: 'jina',
    name: 'Jina Reader',
    category: 'content',
    description: 'Extracts readable text from any URL — handles SPAs, Hebrew, PDFs',
    baseUrl: 'https://r.jina.ai',
    docsUrl: 'https://jina.ai/reader',
  };

  readonly rateLimit: RateLimitConfig = {
    requestsPerWindow: 200,
    windowMs: 60_000,
    maxConcurrent: 5,
    minDelayMs: 100,
  };

  async execute(input: JinaInput, signal?: AbortSignal): Promise<JinaResult> {
    const maxChars = input.maxChars ?? 15_000;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    // Merge caller's abort signal with our timeout
    const combinedSignal = signal
      ? (() => {
          const c = new AbortController();
          signal.addEventListener('abort', () => c.abort());
          controller.signal.addEventListener('abort', () => c.abort());
          return c.signal;
        })()
      : controller.signal;

    try {
      const res = await fetch(`https://r.jina.ai/${input.url}`, {
        signal: combinedSignal,
        headers: {
          Accept: 'text/plain',
          'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });

      clearTimeout(timeout);

      if (!res.ok) {
        return { url: input.url, content: '', readable: false };
      }

      const text = await res.text();
      const content = text.slice(0, maxChars);

      return {
        url: input.url,
        content,
        readable: content.length > 200,
      };
    } catch (e) {
      clearTimeout(timeout);
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      return { url: input.url, content: '', readable: false };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.execute({ url: 'https://example.com', maxChars: 500 });
      return result.readable;
    } catch {
      return false;
    }
  }

  cacheKey(input: JinaInput): string {
    return `jina:${input.url}`;
  }
}
