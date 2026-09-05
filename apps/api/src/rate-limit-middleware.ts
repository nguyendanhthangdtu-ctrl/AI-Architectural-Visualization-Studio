import { DomainError, type RateLimiter } from '@avs/shared';

/**
 * docs/16_SECURITY_SPEC.md "Rate limit expensive AI endpoints" / docs/03 §9
 * "Rate limiting on analysis/generation/QC endpoints, keyed per user/project"
 * (BUILD 18 — zero implementation existed before this). RELEASE 02: now that
 * real auth exists, AI-cost routes key by the authenticated user's id (the
 * "per user" docs/09 always asked for); the two routes that can never have a
 * user yet — `/auth/register`/`/auth/login` — key by remote IP instead,
 * against a separate, tighter limiter (`AppContext.authRateLimiter`).
 */
export function enforceRateLimit(limiter: RateLimiter, key: string): void {
  const result = limiter.tryConsume(key);
  if (!result.allowed) {
    throw new DomainError({
      code: 'RATE_LIMITED',
      message: `Too many requests — retry after ${result.retryAfterSeconds}s.`,
      retryable: true,
    });
  }
}
