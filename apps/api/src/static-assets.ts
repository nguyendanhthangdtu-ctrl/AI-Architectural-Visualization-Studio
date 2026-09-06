import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';
import type { Logger } from '@avs/shared';

/**
 * BUILD 32B (Frontend Production Deployment) — serves the built frontend
 * (`apps/web/dist`) same-origin from apps/api. This is the production
 * realization of the exact split `apps/web/vite.config.ts` already
 * documents for dev (a shared origin; apps/api's own real path prefixes
 * proxied, everything else the frontend) — not a new architecture. It's
 * required, not merely convenient: the session cookie is `SameSite=Strict`
 * (`apps/api/src/auth/session.ts`), whose own doc comment says this is only
 * safe "because this app's supported architecture puts apps/web and
 * apps/api behind the same origin." A separate frontend host on a
 * different `onrender.com` subdomain is a distinct "site" under the Public
 * Suffix List (Render deliberately lists `onrender.com` there, the same
 * reason `github.io`/`vercel.app` are listed) — the browser would never
 * send that cookie cross-site, breaking every authenticated flow.
 *
 * Only ever active when `server.ts` is given a real `webDistDir` — every
 * existing test/context that doesn't set one keeps its exact prior
 * behavior (an unmatched GET falls through to `requireAuth()` exactly as
 * before), verified by dedicated tests.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * BUILD 32B HOTFIX — a real production defect found on the live Render
 * deployment: `WEB_DIST_DIR=apps/web/dist` is a relative path, and it was
 * being resolved against `process.cwd()` — which is NOT guaranteed to be
 * the repo root a launcher actually runs the start command from (verified
 * by reproducing it locally: launching `node dist/server.js` from inside
 * `apps/api` instead of the repo root reproduces the exact reported
 * symptom — the startup log still prints "Serving frontend..." because
 * that only echoes the raw env value, but `GET /` 404s, because
 * `apps/web/dist` resolved against the wrong directory doesn't exist).
 *
 * This file's own on-disk location is a fixed, known anchor regardless of
 * the process's launch directory: `apps/api/src/static-assets.ts` in
 * source, `apps/api/dist/static-assets.js` once built — both exactly two
 * directories below the repo root. Resolving a relative `WEB_DIST_DIR`
 * against that anchor (not `process.cwd()`) makes it correct no matter
 * where the process happens to be launched from. An already-absolute
 * value is used as-is (an explicit override for an unusual deployment
 * layout), and `undefined`/empty stays `undefined` (frontend serving off).
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function resolveWebDistDir(rawValue: string | undefined): string | undefined {
  if (!rawValue) return undefined;
  return isAbsolute(rawValue) ? rawValue : resolve(REPO_ROOT, rawValue);
}

/**
 * BUILD 32B SECOND HOTFIX — the fix above resolves whatever `WEB_DIST_DIR`
 * value it's given correctly, but a second real production incident
 * (`WEB_DIST_DIR` configured as `app/web/dist` — missing the "s" in
 * "apps," reproduced locally: `resolveWebDistDir('app/web/dist')` really
 * does resolve to `<repo root>/app/web/dist`, exactly matching the
 * reported live log path) showed that "resolves correctly" isn't the same
 * as "resolves to somewhere real" — a single mistyped character in an
 * operator-supplied path is silent until someone notices the frontend
 * never loads. There is exactly one correct value this app's own build
 * ever produces (`apps/web/dist`, relative to the repo root this same
 * module already knows how to find) — `server.ts`'s bootstrap uses this
 * as a same-origin-preserving fallback when the configured value doesn't
 * pan out, so a typo degrades to "frontend served from the real default,
 * with a warning" instead of "frontend never loads."
 */
export function defaultWebDistDir(): string {
  return resolve(REPO_ROOT, 'apps', 'web', 'dist');
}

/** Whether `dir` is a real directory containing a real `index.html` — the one thing this whole module needs to actually be true before serving anything from it. */
export function hasIndexHtml(dir: string): boolean {
  const indexPath = join(dir, 'index.html');
  return existsSync(indexPath) && statSync(indexPath).isFile();
}

/**
 * The single decision point `server.ts`'s bootstrap uses: resolves
 * `rawValue` (BUILD 32B's own path-resolution fix), and if the result
 * doesn't actually contain a real `index.html` (BUILD 32B's second
 * hotfix — a typo like `app/web/dist`), falls back to this app's own
 * known-correct default build output location instead of silently never
 * serving the frontend. Logs exactly one warning either way so a
 * misconfiguration is never silent, even though the fallback keeps the
 * app working. Extracted as its own pure(ish) function — taking `logger`
 * as a parameter, never importing a global one — specifically so this
 * decision is unit-testable without spawning a real process (the
 * `isMainModule` bootstrap block in server.ts is not otherwise
 * exercised by any test).
 */
export function resolveEffectiveWebDistDir(rawValue: string | undefined, logger: Logger): string | undefined {
  const configured = resolveWebDistDir(rawValue);
  if (!configured) return undefined;
  if (hasIndexHtml(configured)) return configured;

  const fallback = defaultWebDistDir();
  if (hasIndexHtml(fallback)) {
    logger.warn('WEB_DIST_DIR is set but no index.html was found there — falling back to the real build output location. Fix WEB_DIST_DIR to remove this warning.', {
      configuredWebDistDir: configured,
      fallbackWebDistDir: fallback,
    });
    return fallback;
  }

  logger.warn('WEB_DIST_DIR is set but no index.html was found there (nor at the default build output location) — the frontend will not be served.', {
    configuredWebDistDir: configured,
    fallbackWebDistDir: fallback,
  });
  return configured;
}

/**
 * Resolves a URL path to a real file under `webDistDir`, refusing to ever
 * serve a path that resolves outside it (defense-in-depth — `new URL()`
 * already normalizes `..` segments before this is ever called, per
 * `server.ts`, but this class shouldn't rely on that alone). Returns `null`
 * when the path doesn't correspond to a real file — the caller falls back
 * to `index.html` (SPA client-side routing, e.g. `/architecture`).
 */
function resolveStaticFile(webDistDir: string, requestPath: string): string | null {
  const distRoot = resolve(webDistDir);
  const candidate = resolve(join(distRoot, requestPath));
  const isWithinDist = candidate === distRoot || candidate.startsWith(distRoot + sep);
  if (!isWithinDist || !existsSync(candidate) || !statSync(candidate).isFile()) return null;
  return candidate;
}

export function serveStaticAsset(res: ServerResponse, webDistDir: string, requestPath: string): void {
  const filePath = resolveStaticFile(webDistDir, requestPath) ?? resolveStaticFile(webDistDir, '/index.html');

  if (!filePath) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const contentType = CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': contentType });
  res.end(readFileSync(filePath));
}
