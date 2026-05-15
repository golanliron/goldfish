// UnifiedIntegrationManager
//
// Single entry point for ALL external Data API calls in Goldfish.
//
// Responsibilities:
//   1. Provider registry  — register / lookup by id
//   2. Rate limiting       — token-bucket per provider (via rate-limiter.ts)
//   3. Timeout enforcement — AbortController per call
//   4. In-memory cache     — TTL-based, keyed by provider.cacheKey()
//   5. Error envelope      — every call returns ProviderResponse<T> (never throws)
//   6. Stats               — per-provider metrics accessible at any time
//
// Usage:
//   const manager = getManager();
//   const res = await manager.call<TavilyInput, TavilyResult[]>('tavily', { query: 'קרן רוטשילד' });
//   if (res.success) doSomethingWith(res.data);

import type {
  DataProvider,
  ProviderRequest,
  ProviderResponse,
  ProviderStats,
} from './types';
import { acquire, recordOutcome, getStats, RateLimitError } from './rate-limiter';

// ── In-memory cache ──────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

const DEFAULT_TTL_MS = 5 * 60_000; // 5 minutes

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

function cacheSet<T>(key: string, data: T, ttlMs = DEFAULT_TTL_MS): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── Manager class ─────────────────────────────────────────────────────────────

export class UnifiedIntegrationManager {
  private providers = new Map<string, DataProvider<unknown, unknown>>();

  // ── Registry ───────────────────────────────────────────────────────────────

  register<TIn, TOut>(provider: DataProvider<TIn, TOut>): this {
    if (this.providers.has(provider.meta.id)) {
      console.warn(`[Manager] Overwriting provider: ${provider.meta.id}`);
    }
    this.providers.set(provider.meta.id, provider as DataProvider<unknown, unknown>);
    return this;
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }

  // ── Core call ──────────────────────────────────────────────────────────────

  async call<TIn, TOut>(
    providerId: string,
    input: TIn,
    options?: Omit<ProviderRequest<TIn>, 'input'>
  ): Promise<ProviderResponse<TOut>> {
    const calledAt = new Date().toISOString();
    const start = Date.now();

    const provider = this.providers.get(providerId) as DataProvider<TIn, TOut> | undefined;

    if (!provider) {
      return {
        success: false,
        error: `Unknown provider: "${providerId}". Registered: [${this.list().join(', ')}]`,
        latencyMs: 0,
        cached: false,
        calledAt,
        providerId,
      };
    }

    // ── Cache lookup ─────────────────────────────────────────────────────────
    const cKey = !options?.noCache && provider.cacheKey
      ? provider.cacheKey(input)
      : undefined;

    if (cKey) {
      const cached = cacheGet<TOut>(cKey);
      if (cached !== undefined) {
        recordOutcome(providerId, provider.rateLimit, 'cached', 0);
        return {
          success: true,
          data: cached,
          latencyMs: 0,
          cached: true,
          calledAt,
          providerId,
        };
      }
    }

    // ── Acquire rate-limit slot ──────────────────────────────────────────────
    let release: (() => void) | undefined;
    try {
      release = await acquire(providerId, provider.rateLimit);
    } catch (e) {
      const latencyMs = Date.now() - start;
      if (e instanceof RateLimitError) {
        return {
          success: false,
          error: e.message,
          latencyMs,
          cached: false,
          calledAt,
          providerId,
          remainingQuota: 0,
        };
      }
      return {
        success: false,
        error: `Rate limiter error: ${e instanceof Error ? e.message : String(e)}`,
        latencyMs,
        cached: false,
        calledAt,
        providerId,
      };
    }

    // ── Execute with timeout ──────────────────────────────────────────────────
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const data = await provider.execute(input, controller.signal);
      clearTimeout(timer);
      const latencyMs = Date.now() - start;

      // Cache result
      if (cKey) cacheSet(cKey, data);

      recordOutcome(providerId, provider.rateLimit, 'success', latencyMs);

      const stats = getStats(providerId, provider.rateLimit);
      return {
        success: true,
        data,
        latencyMs,
        cached: false,
        calledAt,
        providerId,
        remainingQuota: stats.windowCallsRemaining,
      };
    } catch (e) {
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      recordOutcome(providerId, provider.rateLimit, 'failure', latencyMs);

      const isTimeout = e instanceof DOMException && e.name === 'AbortError';
      return {
        success: false,
        error: isTimeout
          ? `Provider "${providerId}" timed out after ${timeoutMs}ms`
          : (e instanceof Error ? e.message : String(e)),
        latencyMs,
        cached: false,
        calledAt,
        providerId,
      };
    } finally {
      release?.();
    }
  }

  // ── Convenience: call multiple providers, return first success ────────────

  async callWithFallback<TIn, TOut>(
    providerIds: string[],
    input: TIn,
    options?: Omit<ProviderRequest<TIn>, 'input'>
  ): Promise<ProviderResponse<TOut>> {
    for (const id of providerIds) {
      const res = await this.call<TIn, TOut>(id, input, options);
      if (res.success) return res;
      console.warn(`[Manager] Provider "${id}" failed (${res.error}), trying next…`);
    }
    return {
      success: false,
      error: `All providers failed: [${providerIds.join(', ')}]`,
      latencyMs: 0,
      cached: false,
      calledAt: new Date().toISOString(),
      providerId: providerIds.join(','),
    };
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getStats(providerId: string): ProviderStats | undefined {
    const provider = this.providers.get(providerId);
    if (!provider) return undefined;
    return { ...getStats(providerId, provider.rateLimit), lastCalledAt: undefined };
  }

  getAllStats(): ProviderStats[] {
    return Array.from(this.providers.keys())
      .map(id => this.getStats(id))
      .filter((s): s is ProviderStats => !!s);
  }

  // ── Health check all providers ────────────────────────────────────────────

  async healthCheckAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    await Promise.all(
      Array.from(this.providers.entries()).map(async ([id, p]) => {
        try {
          results[id] = p.healthCheck ? await p.healthCheck() : true;
        } catch {
          results[id] = false;
        }
      })
    );
    return results;
  }

  // ── Cache management ──────────────────────────────────────────────────────

  clearCache(providerId?: string): void {
    if (providerId) {
      for (const key of cache.keys()) {
        if (key.startsWith(`${providerId}:`)) cache.delete(key);
      }
    } else {
      cache.clear();
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
// Module-level singleton so all app code shares one rate-limit state.

let _manager: UnifiedIntegrationManager | null = null;

export function getManager(): UnifiedIntegrationManager {
  if (!_manager) {
    _manager = createDefaultManager();
  }
  return _manager;
}

/** Rebuild with fresh providers — useful in tests */
export function resetManager(): void {
  _manager = null;
}

function createDefaultManager(): UnifiedIntegrationManager {
  // Lazy imports to avoid loading provider SDKs at module evaluation time
  const { TavilyProvider } = require('./tavily');
  const { JinaProvider }   = require('./jina');
  const { ApolloProvider } = require('./apollo');
  const { ICountProvider } = require('./icount');

  return new UnifiedIntegrationManager()
    .register(new TavilyProvider())
    .register(new JinaProvider())
    .register(new ApolloProvider())
    .register(new ICountProvider());
}
