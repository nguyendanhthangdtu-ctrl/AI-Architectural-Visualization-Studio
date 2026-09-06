import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

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
