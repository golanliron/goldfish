// UnifiedIntegrationManager — RateLimiter
//
// Token-bucket implementation per provider.
// One RateLimiter instance is shared across all concurrent requests
// to the same provider, preventing quota overruns.
//
// Design choices:
//   - In-process (Map-based) — zero dependencies, works on Edge/Node.
//   - Each provider gets its own bucket keyed by providerId.
//   - Concurrent-call cap via a simple counter + queued-promise pattern.
//   - Optional minDelayMs enforces a floor between successive calls.

import type { RateLimitConfig } from './types';

interface BucketState {
  /** Tokens available right now */
  tokens: number;
  /** When the current window started (epoch ms) */
  windowStart: number;
  /** How many calls are in-flight right now */
  inFlight: number;
  /** Queue of resolvers waiting for a free slot */
  queue: Array<() => void>;
  /** Timestamp of the last completed call (for minDelayMs) */
  lastCallAt: number;
  // ── Stats ──
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  cachedCalls: number;
  rateLimitedCalls: number;
  totalLatencyMs: number;
}

const buckets = new Map<string, BucketState>();

function getBucket(providerId: string, config: RateLimitConfig): BucketState {
  if (!buckets.has(providerId)) {
    buckets.set(providerId, {
      tokens: config.requestsPerWindow,
      windowStart: Date.now(),
      inFlight: 0,
      queue: [],
      lastCallAt: 0,
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      cachedCalls: 0,
      rateLimitedCalls: 0,
      totalLatencyMs: 0,
    });
  }
  return buckets.get(providerId)!;
}

function refillIfNeeded(bucket: BucketState, config: RateLimitConfig): void {
  const now = Date.now();
  if (now - bucket.windowStart >= config.windowMs) {
    bucket.tokens = config.requestsPerWindow;
    bucket.windowStart = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Acquire a rate-limit slot for `providerId`.
 * Throws RateLimitError if the window is exhausted and cannot wait.
 * Returns a release() function the caller MUST invoke when done.
 */
export async function acquire(
  providerId: string,
  config: RateLimitConfig
): Promise<() => void> {
  const bucket = getBucket(providerId, config);
  refillIfNeeded(bucket, config);

  const maxConcurrent = config.maxConcurrent ?? 5;

  // Wait for a concurrent slot
  if (bucket.inFlight >= maxConcurrent) {
    await new Promise<void>(resolve => {
      bucket.queue.push(resolve);
    });
  }

  // Wait for a token in this window
  if (bucket.tokens <= 0) {
    // Compute wait until window resets
    const waitMs = config.windowMs - (Date.now() - bucket.windowStart);
    if (waitMs > 0) {
      bucket.rateLimitedCalls++;
      await sleep(waitMs);
      refillIfNeeded(bucket, config);
    }
    if (bucket.tokens <= 0) {
      bucket.rateLimitedCalls++;
      throw new RateLimitError(providerId, config);
    }
  }

  // Enforce minDelay between calls
  const minDelay = config.minDelayMs ?? 0;
  if (minDelay > 0) {
    const elapsed = Date.now() - bucket.lastCallAt;
    if (elapsed < minDelay) {
      await sleep(minDelay - elapsed);
    }
  }

  bucket.tokens--;
  bucket.inFlight++;
  bucket.totalCalls++;
  bucket.lastCallAt = Date.now();

  return function release() {
    bucket.inFlight--;
    // Wake the next waiter in queue
    const next = bucket.queue.shift();
    if (next) next();
  };
}

/** Record outcome after a call completes */
export function recordOutcome(
  providerId: string,
  config: RateLimitConfig,
  outcome: 'success' | 'failure' | 'cached',
  latencyMs: number
): void {
  const bucket = getBucket(providerId, config);
  if (outcome === 'success') bucket.successCalls++;
  else if (outcome === 'failure') bucket.failedCalls++;
  else if (outcome === 'cached') bucket.cachedCalls++;
  bucket.totalLatencyMs += latencyMs;
}

/** Read current stats for a provider */
export function getStats(providerId: string, config: RateLimitConfig) {
  const bucket = getBucket(providerId, config);
  refillIfNeeded(bucket, config);
  const totalFinished = bucket.successCalls + bucket.failedCalls + bucket.cachedCalls;
  return {
    providerId,
    totalCalls: bucket.totalCalls,
    successCalls: bucket.successCalls,
    failedCalls: bucket.failedCalls,
    cachedCalls: bucket.cachedCalls,
    rateLimitedCalls: bucket.rateLimitedCalls,
    avgLatencyMs: totalFinished > 0 ? Math.round(bucket.totalLatencyMs / totalFinished) : 0,
    windowCallsUsed: config.requestsPerWindow - bucket.tokens,
    windowCallsRemaining: bucket.tokens,
  };
}

/** Reset a provider's bucket (useful in tests) */
export function resetBucket(providerId: string): void {
  buckets.delete(providerId);
}

// ── Error type ─────────────────────────────────────────────────────────────

export class RateLimitError extends Error {
  constructor(providerId: string, config: RateLimitConfig) {
    super(
      `[RateLimit] Provider "${providerId}" exhausted (${config.requestsPerWindow} req / ${config.windowMs}ms window). Try again after ${Math.ceil(config.windowMs / 1000)}s.`
    );
    this.name = 'RateLimitError';
  }
}
