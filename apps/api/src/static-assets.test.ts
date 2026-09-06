import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import type { Logger } from '@avs/shared';
import { defaultWebDistDir, hasIndexHtml, resolveEffectiveWebDistDir, resolveWebDistDir, serveStaticAsset } from './static-assets.js';

function fakeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function fakeResponse() {
  const chunks: Buffer[] = [];
  let statusCode = 0;
  let headers: Record<string, string> = {};
  return {
    writeHead(status: number, h: Record<string, string>) {
      statusCode = status;
      headers = h;
    },
    end(data?: Buffer | string) {
      if (data) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    },
    get status() {
      return statusCode;
    },
    get headers() {
      return headers;
    },
    get body() {
      return Buffer.concat(chunks).toString('utf-8');
    },
  };
}

describe('serveStaticAsset (BUILD 32B Frontend Production Deployment)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'avs-static-test-'));
    writeFileSync(join(dir, 'index.html'), '<html>SPA shell</html>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1);');
    writeFileSync(join(dir, 'assets', 'index-abc123.css'), 'body{color:red}');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves a real file with the correct content-type when the path matches one exactly', () => {
    const res = fakeResponse();
    serveStaticAsset(res as never, dir, '/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.body).toBe('console.log(1);');
  });

  it('serves the CSS file with the correct content-type', () => {
    const res = fakeResponse();
    serveStaticAsset(res as never, dir, '/assets/index-abc123.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
  });

  it('falls back to index.html (SPA client-side routing) for a path with no matching real file', () => {
    const res = fakeResponse();
    serveStaticAsset(res as never, dir, '/architecture');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toBe('<html>SPA shell</html>');
  });

  it('falls back to index.html for the root path', () => {
    const res = fakeResponse();
    serveStaticAsset(res as never, dir, '/');
    expect(res.status).toBe(200);
    expect(res.body).toBe('<html>SPA shell</html>');
  });

  it('never serves a file outside webDistDir even for a path-traversal-shaped request — falls back to index.html', () => {
    const res = fakeResponse();
    serveStaticAsset(res as never, dir, '/../../../etc/passwd');
    expect(res.status).toBe(200); // SPA fallback, not the traversed file
    expect(res.body).toBe('<html>SPA shell</html>');
  });
});

describe('resolveWebDistDir (BUILD 32B HOTFIX — real production defect: a relative WEB_DIST_DIR resolved against process.cwd() 404s when the process is launched from any directory other than the repo root, reproduced by running the real production build from apps/api instead of the repo root)', () => {
  it('returns undefined for an unset/empty value — frontend serving stays off, exact prior behavior', () => {
    expect(resolveWebDistDir(undefined)).toBeUndefined();
    expect(resolveWebDistDir('')).toBeUndefined();
  });

  it('uses an already-absolute value as-is', () => {
    const absolute = process.platform === 'win32' ? 'C:\\some\\absolute\\path' : '/some/absolute/path';
    expect(resolveWebDistDir(absolute)).toBe(absolute);
  });

  it('resolves a relative value against this module\'s own on-disk location (repo root), not process.cwd() — the exact fix for the reported defect', () => {
    // This test file lives in the same directory as static-assets.ts
    // (apps/api/src), so computing "repo root" the identical way here
    // independently verifies resolveWebDistDir's own computation without
    // just re-asserting its implementation.
    const expectedRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const result = resolveWebDistDir('apps/web/dist');
    expect(result).toBe(join(expectedRepoRoot, 'apps', 'web', 'dist'));
    expect(isAbsolute(result!)).toBe(true);
  });

  it('BUILD 32B: reproduces the exact second real production incident — a typo (missing the "s" in "apps") resolves to a real, wrong, sibling path, not an error', () => {
    // The live Render log reported the resolved path as "/app/app/web/dist"
    // (a double "app" segment) — this is exactly what a Docker WORKDIR of
    // "/app" plus a WEB_DIST_DIR value of "app/web/dist" (typo) produces,
    // confirming the configured *value* was wrong, not this function's math.
    const withTypo = resolveWebDistDir('app/web/dist');
    const withoutTypo = resolveWebDistDir('apps/web/dist');
    expect(withTypo).not.toBe(withoutTypo);
    expect(withTypo).toContain(`${join('app', 'web', 'dist')}`);
  });
});

describe('resolveEffectiveWebDistDir (BUILD 32B SECOND HOTFIX — self-heals a misconfigured WEB_DIST_DIR)', () => {
  let configuredDir: string;

  beforeEach(() => {
    configuredDir = mkdtempSync(join(tmpdir(), 'avs-web-dist-configured-'));
  });

  afterEach(() => {
    rmSync(configuredDir, { recursive: true, force: true });
  });

  it('returns undefined and never warns when WEB_DIST_DIR is unset — exact prior behavior, no fallback engaged', () => {
    const logger = fakeLogger();
    expect(resolveEffectiveWebDistDir(undefined, logger)).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('uses the configured directory as-is, with no warning, when it already has a real index.html', () => {
    writeFileSync(join(configuredDir, 'index.html'), '<html>real build output</html>');
    const logger = fakeLogger();
    expect(resolveEffectiveWebDistDir(configuredDir, logger)).toBe(configuredDir);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to the real default build output location — with a clear warning — when the configured directory has no index.html (the exact reported "app/web/dist" typo scenario), if that default has actually been built', () => {
    // configuredDir deliberately has no index.html — this is the "typo" case.
    const logger = fakeLogger();
    const result = resolveEffectiveWebDistDir(configuredDir, logger);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    if (hasIndexHtml(defaultWebDistDir())) {
      // apps/web/dist has actually been built in this environment (e.g. after `npm run build`) — the fallback should succeed and be used.
      expect(result).toBe(defaultWebDistDir());
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('falling back to the real build output location'), expect.anything());
    } else {
      // apps/web/dist was never built here — nothing to fall back to; the misconfigured value is kept (same graceful-degradation as before this hotfix), with a warning saying so.
      expect(result).toBe(configuredDir);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the frontend will not be served'), expect.anything());
    }
  });
});
