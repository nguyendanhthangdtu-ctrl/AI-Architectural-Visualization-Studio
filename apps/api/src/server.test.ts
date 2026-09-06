import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.js';
import { createAppContext } from './app-context.js';
import { registerTestUser, TEST_REGISTRATION_SECRET, withCookie } from './test-helpers/auth.js';

describe('apps/api bootstrap server', () => {
  let server: ReturnType<typeof createApp> | undefined;

  afterEach(() => {
    server?.close();
  });

  it('responds to GET /health', async () => {
    server = createApp();
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  it('BUILD 32A HOTFIX: responds 200 to HEAD /health, never 401 — real defect found via a live Render deployment (its health checker sends HEAD, which previously fell through to requireAuth())', async () => {
    server = createApp();
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health`, { method: 'HEAD' });
    expect(res.status).toBe(200);
  });

  /**
   * RELEASE 02 — `requireAuth()` runs before route matching for every
   * non-public path, so an unauthenticated request to a route that doesn't
   * even exist gets 401, not 404 — deliberate: an anonymous caller should
   * never be able to enumerate which routes exist by comparing 401 vs 404.
   * A signed-in caller still gets a real 404 for an unknown route.
   */
  it('BUILD 32A HOTFIX: a HEAD request to any OTHER route still requires auth — the /health,/ready HEAD fix is scoped to exactly those two routes', async () => {
    server = createApp();
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/projects`, { method: 'HEAD' });
    expect(res.status).toBe(401);
  });

  it('rejects an unauthenticated request to an unknown route with 401, not a route-existence-revealing 404', async () => {
    server = createApp();
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'UNAUTHENTICATED', retryable: false });
    expect(Object.keys(body)).not.toContain('stack');
  });

  it('returns a normalized error envelope for an unknown route once authenticated, with no stack trace leaked', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    server = createApp(context);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;
    const session = await registerTestUser(baseUrl);

    const res = await fetch(`${baseUrl}/unknown`, withCookie({}, session.cookie));
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'NOT_FOUND', retryable: false });
    expect(Object.keys(body)).not.toContain('stack');
  });
});

describe('apps/api same-origin frontend serving (BUILD 32B, opt-in via webDistDir)', () => {
  let server: ReturnType<typeof createApp> | undefined;
  let webDistDir: string;

  beforeEach(() => {
    webDistDir = mkdtempSync(join(tmpdir(), 'avs-web-dist-test-'));
    writeFileSync(join(webDistDir, 'index.html'), '<html>SPA shell</html>');
  });

  afterEach(() => {
    server?.close();
    rmSync(webDistDir, { recursive: true, force: true });
  });

  it('does NOT serve the frontend when webDistDir is not passed — exact prior behavior for every existing caller', async () => {
    server = createApp();
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/architecture`);
    expect(res.status).toBe(401); // falls through to requireAuth exactly as before, never the static handler
  });

  it('BUILD 32B HOTFIX: GET / serves the frontend index.html, not "Not found" — the exact real defect reported on the live Render deployment', async () => {
    server = createApp(createAppContext(), undefined, undefined, undefined, webDistDir);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe('<html>SPA shell</html>');
  });

  it('serves the frontend shell for a client-side route once webDistDir is passed', async () => {
    server = createApp(createAppContext(), undefined, undefined, undefined, webDistDir);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/architecture`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>SPA shell</html>');
  });

  it('still routes real API paths correctly, never shadowed by the static frontend handler', async () => {
    server = createApp(createAppContext(), undefined, undefined, undefined, webDistDir);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: 'ok' });

    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(ready.status).toBe(200);
  });

  it('still requires auth for a real protected API route, never serving the SPA shell instead', async () => {
    server = createApp(createAppContext(), undefined, undefined, undefined, webDistDir);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/projects`, { method: 'POST' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'UNAUTHENTICATED' }); // a real API error envelope, not the SPA HTML shell
  });
});
