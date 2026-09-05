import type { ServerResponse } from 'node:http';

/**
 * Permissive dev-mode CORS — apps/web (Vite dev server) and apps/api run on
 * different origins locally, and no auth/cookies exist yet to make a
 * wildcard origin unsafe (no credentials are ever sent). This MUST be
 * tightened to an explicit allowlist before production (BUILD 18 Production
 * Hardening) — tracked in docs/03 §13, not silently left as-is.
 */
export function applyCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
