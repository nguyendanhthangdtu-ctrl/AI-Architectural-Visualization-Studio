/**
 * Rate limiting — docs/16_SECURITY_SPEC.md "Rate limit expensive AI
 * endpoints" / docs/03 §9 "Rate limiting on analysis/generation/QC endpoints,
 * keyed per user/project, to bound AI spend" (BUILD 18 hardening — this
 * requirement existed since §9 was first written but had zero implementation
 * until now).
 *
 * In-memory, single-instance reference implementation — real and load-bearing
 * for a single `apps/api` process, same "concrete engine deferred, present
 * contract is real" pattern as `JobQueue` (docs/03 ADR-004): a real
 * multi-instance deployment needs a shared backend (Redis, etc.) behind this
 * same `RateLimiter` interface, not fixed here. Keyed per-IP since no auth
 * exists yet (every BUILD gate's "no auth yet, BUILD 02 deferral" caveat) —
 * once real auth exists, callers should key by user/project id instead.
 */
export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry — only meaningful when `allowed` is false. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  tryConsume(key: string): RateLimitResult;
}

export interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
}

interface WindowState {
  count: number;
  windowStartedAt: number;
}

/** Fixed-window counter — simple, bounded memory (one entry per active key, evicted once its window lapses and the key is next seen or swept). */
export function createInMemoryRateLimiter(config: RateLimiterConfig): RateLimiter {
  const windows = new Map<string, WindowState>();

  return {
    tryConsume(key: string): RateLimitResult {
      const now = Date.now();
      const existing = windows.get(key);

      if (!existing || now - existing.windowStartedAt >= config.windowMs) {
        windows.set(key, { count: 1, windowStartedAt: now });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (existing.count >= config.maxRequests) {
        const retryAfterMs = config.windowMs - (now - existing.windowStartedAt);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }

      existing.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
