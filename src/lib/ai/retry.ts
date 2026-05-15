/**
 * withRetry — Exponential Backoff for AI API calls
 *
 * Retries on:
 *   - HTTP 429 (rate limit / quota exceeded)
 *   - HTTP 503 / 504 (service unavailable / gateway timeout)
 *   - Anthropic "overloaded_error"
 *   - Gemini "RESOURCE_EXHAUSTED" / "SERVICE_UNAVAILABLE"
 *
 * Backoff schedule (baseDelayMs = 2000):
 *   attempt 1 → wait 2s
 *   attempt 2 → wait 4s
 *   attempt 3 → wait 8s
 *   (then throws)
 */

// Errors that warrant a retry
const RETRYABLE_PATTERNS = [
  '429',
  '503',
  '504',
  'rate_limit',
  'rate limit',
  'overloaded',
  'overloaded_error',
  'RESOURCE_EXHAUSTED',
  'SERVICE_UNAVAILABLE',
  'quota',
  'too many requests',
  'Too Many Requests',
];

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message || '';
  return RETRYABLE_PATTERNS.some(p => msg.includes(p));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wraps any async function with exponential-backoff retry.
 *
 * @param fn          - The async function to call (e.g. () => anthropic.messages.create(...))
 * @param maxAttempts - Total attempts before giving up (default: 4)
 * @param baseDelayMs - Base delay in ms; doubles each retry (default: 2000 → 2s, 4s, 8s)
 * @param label       - Optional label for log output
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 4,
  baseDelayMs = 2000,
  label = 'AI call',
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      if (!isRetryable(err) || attempt === maxAttempts) {
        // Non-retryable error, or we've exhausted our attempts — rethrow
        throw err;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1); // 2s, 4s, 8s
      console.warn(
        `[retry] ${label} — attempt ${attempt}/${maxAttempts} failed (retryable). ` +
        `Waiting ${delayMs / 1000}s before retry...`,
      );
      await sleep(delayMs);
    }
  }

  // Should never reach here, but TypeScript needs a throw
  throw lastErr;
}
