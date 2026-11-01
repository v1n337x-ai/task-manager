/**
 * In-process rate limiter for login attempts (brief section 8).
 * Fixed-window counter keyed by IP + identity. For a single-credential internal
 * tool this is the "practical" protection the brief asks for; a shared store
 * (Redis) is unnecessary at this scale.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, max: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= max) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, remaining: max - bucket.count, retryAfterSeconds: 0 };
}

/** Test hook: clear all buckets. */
export function resetRateLimiter(): void {
  buckets.clear();
}

/** Prevent unbounded map growth (best-effort sweep on access). */
export function sweepExpiredBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
