// UnifiedIntegrationManager — Provider Interface
//
// Every external Data API (Tavily, Apollo, iCount, Jina, …) implements
// DataProvider<TInput, TOutput>. The Manager wraps every call with:
//   - Rate limiting (token bucket per provider)
//   - Unified error envelope
//   - Optional result caching hook
//
// Adding a new API = implement DataProvider + register in manager.ts
// BusinessTab / OpportunitiesTab never import a provider directly — only the Manager.

// ── Provider identity ────────────────────────────────────────────────────────

export type ProviderCategory =
  | 'search'          // Tavily, Google Search
  | 'enrichment'      // Apollo, Clearbit
  | 'content'         // Jina Reader, Diffbot
  | 'accounting'      // iCount, QuickBooks
  | 'crm'             // Salesforce, HubSpot
  | 'social'          // LinkedIn, Facebook Graph
  | 'grants'          // internal grant DB, GrantWatch
  | 'custom';

export interface ProviderMeta {
  id: string;               // unique slug, e.g. 'tavily', 'apollo', 'icount'
  name: string;             // human label
  category: ProviderCategory;
  description: string;
  baseUrl?: string;
  docsUrl?: string;
}

// ── Rate-limit config (per provider) ────────────────────────────────────────

export interface RateLimitConfig {
  /** Max requests per window */
  requestsPerWindow: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Max concurrent in-flight requests (default: 5) */
  maxConcurrent?: number;
  /** Extra delay between calls in ms (throttle, default: 0) */
  minDelayMs?: number;
}

// ── Standard call envelope ───────────────────────────────────────────────────

export interface ProviderRequest<TInput = unknown> {
  /** Provider-specific input payload */
  input: TInput;
  /** Optional: org context for logging / rate-limit bucketing */
  orgId?: string;
  /** Override timeout in ms (default: 30_000) */
  timeoutMs?: number;
  /** Skip cache for this call */
  noCache?: boolean;
}

export interface ProviderResponse<TOutput = unknown> {
  success: boolean;
  data?: TOutput;
  error?: string;
  /** Milliseconds the call took */
  latencyMs: number;
  /** true if result came from cache */
  cached: boolean;
  /** Timestamp ISO */
  calledAt: string;
  /** Which provider served this */
  providerId: string;
  /** Remaining quota in current window (if provider exposes it) */
  remainingQuota?: number;
}

// ── The interface every Data Provider must implement ─────────────────────────

export interface DataProvider<TInput = unknown, TOutput = unknown> {
  readonly meta: ProviderMeta;
  readonly rateLimit: RateLimitConfig;

  /**
   * Execute one unit of work against the external API.
   * The Manager wraps this with rate limiting — providers do NOT
   * need to implement throttling themselves.
   */
  execute(input: TInput, signal?: AbortSignal): Promise<TOutput>;

  /**
   * Optional: health check (returns true if credentials are valid).
   * Called on startup and periodically by the Manager.
   */
  healthCheck?(): Promise<boolean>;

  /**
   * Optional: derive a cache key from input.
   * If omitted, caching is skipped for this provider.
   */
  cacheKey?(input: TInput): string;
}

// ── Manager-level stats ───────────────────────────────────────────────────────

export interface ProviderStats {
  providerId: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  cachedCalls: number;
  rateLimitedCalls: number;
  avgLatencyMs: number;
  lastCalledAt?: string;
  windowCallsUsed: number;
  windowCallsRemaining: number;
}
