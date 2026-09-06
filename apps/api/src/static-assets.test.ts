import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { resolveWebDistDir, serveStaticAsset } from './static-assets.js';

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
});
