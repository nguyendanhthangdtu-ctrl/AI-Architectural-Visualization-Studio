import type { ServerResponse } from 'node:http';

/**
 * Security response headers — RELEASE 02 (docs/16). `apps/api` is a pure
 * JSON(+raw asset bytes) API — it never serves HTML/JS meant to be rendered
 * by a browser as a page — so `default-src 'none'` is both safe and correct,
 * not a compromise: there is nothing on this origin a CSP would need to
 * permit. `Strict-Transport-Security` is sent only when `trustHttps` is true
 * (env.ts's `TRUST_HTTPS`) — sending it over plain HTTP would be actively
 * wrong (it tells browsers to force HTTPS on this host), and this app never
 * fakes a TLS assumption it can't back up (docs/03 §11 — HTTPS is terminated
 * by a reverse proxy, not this process).
 */
export function applySecurityHeaders(res: ServerResponse, options: { trustHttps: boolean }): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  if (options.trustHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
}
