import type { ServerResponse } from 'node:http';

/**
 * Security response headers — RELEASE 02 (docs/16). `Strict-Transport-Security`
 * is sent only when `trustHttps` is true (env.ts's `TRUST_HTTPS`) — sending
 * it over plain HTTP would be actively wrong (it tells browsers to force
 * HTTPS on this host), and this app never fakes a TLS assumption it can't
 * back up (docs/03 §11 — HTTPS is terminated by a reverse proxy, not this
 * process).
 *
 * BUILD 32B HOTFIX — `Content-Security-Policy` was `default-src 'none'`,
 * written when this comment's own reasoning was true: "apps/api is a pure
 * JSON(+raw asset bytes) API — it never serves HTML/JS meant to be rendered
 * by a browser as a page." BUILD 32B made that false — `apps/api` now
 * optionally serves the built frontend same-origin
 * (`apps/api/src/static-assets.ts`) — and this was a real production defect
 * found via direct browser inspection of the live deployment: `'none'`
 * blocks EVERYTHING not explicitly allowed by a more specific directive,
 * including the frontend's own same-origin `fetch()` calls to this same
 * API (blocked by the implicit `connect-src 'none'`) and, per browser CSP
 * enforcement, its script/style execution too — the browser loaded the real
 * `index.html` (confirmed 200) but then rendered nothing, exactly the
 * reported blank white page. `'self'` is still maximally restrictive for
 * this app's real needs — every script/style/fetch/asset this frontend
 * ever loads is same-origin (confirmed: no third-party CDN, no external
 * fonts) — it only stops blocking the one origin (this app's own) that a
 * same-origin deployment obviously needs to allow.
 */
export function applySecurityHeaders(res: ServerResponse, options: { trustHttps: boolean }): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  if (options.trustHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
}
