import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * CORS allowlist — docs/16_SECURITY_SPEC.md / docs/03 §13's tracked "must be
 * tightened to an explicit allowlist before production" (BUILD 18 Production
 * Hardening). Reflects the request's `Origin` back only when it's on the
 * configured allowlist (`ALLOWED_ORIGINS`, comma-separated) — every other
 * origin gets no CORS header at all, so the browser blocks it. Defaults to
 * the Vite dev server's own default origin so local development keeps
 * working with zero configuration, matching every other "real for now,
 * dev-safe default" convention in this codebase (e.g. `RENDER_CORE_SELECTION`
 * defaulting to a working adapter).
 */
const DEFAULT_DEV_ORIGIN = 'http://localhost:5173';

export function parseAllowedOrigins(raw: string | undefined): readonly string[] {
  if (!raw || raw.trim().length === 0) return [DEFAULT_DEV_ORIGIN];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function applyCorsHeaders(req: IncomingMessage, res: ServerResponse, allowedOrigins: readonly string[]): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
