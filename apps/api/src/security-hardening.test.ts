import { describe, expect, it, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.js';
import { createAppContext } from './app-context.js';
import { registerTestUser, TEST_REGISTRATION_SECRET, withCookie } from './test-helpers/auth.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('apps/api security hardening (RELEASE 02)', () => {
  let server: ReturnType<typeof createApp> | undefined;
  let baseUrl = '';

  afterEach(() => {
    server?.close();
  });

  async function start(overrides: Parameters<typeof createAppContext>[0] = {}) {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET, ...overrides });
    server = createApp(context);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  }

  describe('security response headers', () => {
    it('sends real, safe defaults on every response — no HSTS when HTTPS is not trusted', async () => {
      await start();
      const res = await fetch(`${baseUrl}/health`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
      expect(res.headers.get('strict-transport-security')).toBeNull();
    });

    it('sends Strict-Transport-Security only when TRUST_HTTPS is true', async () => {
      await start({ cookieSecure: true });
      const res = await fetch(`${baseUrl}/health`);
      expect(res.headers.get('strict-transport-security')).toMatch(/max-age=/);
    });

    it('marks the session cookie Secure only when TRUST_HTTPS is true', async () => {
      await start({ cookieSecure: true });
      const session = await registerTestUser(baseUrl);
      // registerTestUser already asserted a cookie was set; re-derive the raw header to check the Secure flag specifically.
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: session.email, password: 'correct horse battery staple 42' }),
      });
      expect(res.headers.get('set-cookie')).toContain('Secure');
    });
  });

  describe('path traversal', () => {
    it('never accepts a slash in an asset id, and a %2F-encoded one stays a literal, harmless filename component', async () => {
      await start();
      const session = await registerTestUser(baseUrl);

      const literalSlash = await fetch(`${baseUrl}/assets/..%2F..%2Fetc%2Fpasswd`, withCookie({}, session.cookie));
      // Whatever it resolves to, it must be a normal 404/ASSET_NOT_FOUND — never a 200 with unexpected file contents, never a 500.
      expect(literalSlash.status).toBe(404);
      await expect(literalSlash.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    });

    it('never resolves a raw ".." asset id to a 200 — WHATWG URL parsing collapses it before routing even sees it', async () => {
      await start();
      const session = await registerTestUser(baseUrl);
      const res = await fetch(`${baseUrl}/assets/..`, withCookie({}, session.cookie));
      // Node's URL normalizes "/assets/.." to "/" before this app's own route matching runs,
      // so this lands on the generic "no route" 404 rather than the asset route's own —
      // either way, never a 200, never a 500, never anything but a safe rejection.
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toMatchObject({ retryable: false });
    });
  });

  describe('AI-route rate limiting (keyed per authenticated user)', () => {
    it('rate-limits an authenticated user hammering an AI-cost route', async () => {
      await start();
      const session = await registerTestUser(baseUrl);
      const createRes = await fetch(`${baseUrl}/projects`, withCookie({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Villa A', module: 'architecture' }),
      }, session.cookie));
      const project = (await createRes.json()) as { id: string };
      const uploadRes = await fetch(`${baseUrl}/projects/${project.id}/assets`, withCookie({
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: ONE_PIXEL_PNG,
      }, session.cookie));
      const asset = (await uploadRes.json()) as { id: string };

      const attempts: number[] = [];
      for (let i = 0; i < 32; i += 1) {
        const res = await fetch(`${baseUrl}/projects/${project.id}/analysis`, withCookie({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ assetId: asset.id }),
        }, session.cookie));
        attempts.push(res.status);
      }
      expect(attempts).toContain(429);
    });

    it('rate limits are tracked independently per user, not globally', async () => {
      await start();
      const userA = await registerTestUser(baseUrl, 'a@example.com');
      const userB = await registerTestUser(baseUrl, 'b@example.com');

      for (let i = 0; i < 30; i += 1) {
        await fetch(`${baseUrl}/projects/does-not-exist/analysis`, withCookie({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ assetId: 'x' }),
        }, userA.cookie));
      }
      // userA should now be limited...
      const aRes = await fetch(`${baseUrl}/projects/does-not-exist/analysis`, withCookie({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetId: 'x' }),
      }, userA.cookie));
      expect(aRes.status).toBe(429);

      // ...but userB, never having made a request, is not.
      const bRes = await fetch(`${baseUrl}/projects/does-not-exist/analysis`, withCookie({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetId: 'x' }),
      }, userB.cookie));
      expect(bRes.status).toBe(404);
    });
  });

  describe('error/secret redaction', () => {
    it('never leaks a stack trace or the configured registration secret on a rejected request', async () => {
      await start();
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'x@example.com', password: 'password123', registrationSecret: 'wrong-guess' }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body)).not.toContain('stack');
      expect(JSON.stringify(body)).not.toContain(TEST_REGISTRATION_SECRET);
    });
  });
});
