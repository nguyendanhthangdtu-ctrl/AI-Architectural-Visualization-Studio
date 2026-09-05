import type { IncomingMessage } from 'node:http';
import { DomainError } from '@avs/shared';
import type { AppContext } from './app-context.js';

/**
 * docs/16_SECURITY_SPEC.md "Rate limit expensive AI endpoints" / docs/03 §9
 * "Rate limiting on analysis/generation/QC endpoints, keyed per user/project"
 * (BUILD 18 — zero implementation existed before this). Keyed by remote IP:
 * no auth exists yet (every BUILD gate's "no auth yet, BUILD 02 deferral"
 * caveat), so there's no real user/project id to key by more precisely —
 * once real auth exists, callers should key by that instead.
 */
export function enforceRateLimit(context: AppContext, req: IncomingMessage): void {
  const key = req.socket.remoteAddress ?? 'unknown';
  const result = context.rateLimiter.tryConsume(key);
  if (!result.allowed) {
    throw new DomainError({
      code: 'RATE_LIMITED',
      message: `Too many requests — retry after ${result.retryAfterSeconds}s.`,
      retryable: true,
    });
  }
}
