import type { IncomingMessage } from 'node:http';
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
/**
 * BUILD 32 (Production Deployment) — see `env.ts`'s `TRUST_PROXY` doc
 * comment for the full reasoning. `trustProxy: false` (the default, and
 * every existing caller's exact prior behavior) always uses the real
 * socket address, never a client-controllable header. `trustProxy: true`
 * takes the leftmost address in `X-Forwarded-For` — the original client,
 * assuming exactly one reverse-proxy hop (docs/03 §11's documented
 * topology; this app has no multi-hop-proxy-chain configuration, so it
 * doesn't pretend to support one). Falls back to the socket address if the
 * header is absent (a direct connection even though `TRUST_PROXY=true`).
 */
export function resolveClientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const header = req.headers['x-forwarded-for'];
    const value = Array.isArray(header) ? header[0] : header;
    const firstAddress = value?.split(',')[0]?.trim();
    if (firstAddress) return firstAddress;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

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
