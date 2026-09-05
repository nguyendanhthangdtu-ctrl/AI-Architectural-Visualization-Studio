import { describe, expect, it, vi } from 'vitest';
import { createInMemoryRateLimiter } from './rate-limiter.js';

describe('createInMemoryRateLimiter', () => {
  it('allows up to maxRequests within the window, then denies', () => {
    const limiter = createInMemoryRateLimiter({ maxRequests: 3, windowMs: 60_000 });
    expect(limiter.tryConsume('ip-1').allowed).toBe(true);
    expect(limiter.tryConsume('ip-1').allowed).toBe(true);
    expect(limiter.tryConsume('ip-1').allowed).toBe(true);
    const denied = limiter.tryConsume('ip-1');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks each key independently', () => {
    const limiter = createInMemoryRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    expect(limiter.tryConsume('ip-1').allowed).toBe(true);
    expect(limiter.tryConsume('ip-2').allowed).toBe(true);
    expect(limiter.tryConsume('ip-1').allowed).toBe(false);
  });

  it('resets once the window elapses', () => {
    vi.useFakeTimers();
    try {
      const limiter = createInMemoryRateLimiter({ maxRequests: 1, windowMs: 1000 });
      expect(limiter.tryConsume('ip-1').allowed).toBe(true);
      expect(limiter.tryConsume('ip-1').allowed).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(limiter.tryConsume('ip-1').allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
