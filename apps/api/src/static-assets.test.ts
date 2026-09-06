import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { serveStaticAsset } from './static-assets.js';

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
