import { describe, expect, it, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.js';
import { createAppContext, type AppContext } from '../app-context.js';
import { registerTestUser, TEST_PASSWORD, TEST_REGISTRATION_SECRET, withCookie } from '../test-helpers/auth.js';

describe('apps/api auth routes (RELEASE 02 Security & Production Access Hardening)', () => {
  let server: ReturnType<typeof createApp> | undefined;
  let baseUrl = '';

  afterEach(() => {
    server?.close();
  });

  async function start(context: AppContext) {
    server = createApp(context);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  }

  describe('POST /auth/register', () => {
    it('is disabled by default (deny-by-default) when no REGISTRATION_SECRET is configured', async () => {
      await start(createAppContext());
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'x@example.com', password: TEST_PASSWORD, registrationSecret: 'anything' }),
      });
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({ code: 'REGISTRATION_DISABLED' });
    });

    it('rejects the wrong registration secret', async () => {
      await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'x@example.com', password: TEST_PASSWORD, registrationSecret: 'wrong-secret' }),
      });
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({ code: 'REGISTRATION_FORBIDDEN' });
    });

    it('creates a real account, signs it in immediately, and never returns the password hash', async () => {
      await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'real@example.com', password: TEST_PASSWORD, registrationSecret: TEST_REGISTRATION_SECRET }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['email']).toBe('real@example.com');
      expect(Object.keys(body)).not.toContain('passwordHash');
      expect(Object.keys(body)).not.toContain('password');
      expect(res.headers.get('set-cookie')).toMatch(/^avs_session=.+HttpOnly/);
    });

    it('rejects a password shorter than 8 characters', async () => {
      await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'x@example.com', password: 'short', registrationSecret: TEST_REGISTRATION_SECRET }),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects registering the same email twice', async () => {
      await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
      await registerTestUser(baseUrl, 'dup@example.com');
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'dup@example.com', password: TEST_PASSWORD, registrationSecret: TEST_REGISTRATION_SECRET }),
      });
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
    });

    it('is rate-limited (brute-force/mass-account-creation protection)', async () => {
      await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
      const attempts = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          fetch(`${baseUrl}/auth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: `user${i}@example.com`, password: TEST_PASSWORD, registrationSecret: TEST_REGISTRATION_SECRET }),
          }),
        ),
      );
      expect(attempts.some((r) => r.status === 429)).toBe(true);
    });
  });

  describe('POST /auth/login', () => {
    it('signs in with the correct credentials and sets a real session cookie', async () => {
      await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
      await registerTestUser(baseUrl, 'login@example.com');
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'login@example.com', password: TEST_PASSWORD }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toMatch(/^avs_session=.+HttpOnly/);
    });

    it('rejects a wrong password with the same generic message as a wrong email (never reveals which)', async () => {
      await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
      await registerTestUser(baseUrl, 'known@example.com');

      const wrongPassword = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'known@example.com', password: 'totally-wrong-password' }),
      });
      const unknownEmail = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com', password: TEST_PASSWORD }),
      });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      const wrongPasswordBody = await wrongPassword.json();
      const unknownEmailBody = await unknownEmail.json();
      expect(wrongPasswordBody).toEqual(unknownEmailBody);
      expect(wrongPasswordBody).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('is rate-limited', async () => {
      await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
      await registerTestUser(baseUrl, 'ratelimit@example.com');
      const attempts = await Promise.all(
        Array.from({ length: 12 }, () =>
          fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'ratelimit@example.com', password: 'wrong' }),
          }),
        ),
      );
      expect(attempts.some((r) => r.status === 429)).toBe(true);
    });
  });

  describe('GET /auth/me', () => {
    it('returns 401 without a session', async () => {
      await start(createAppContext());
      const res = await fetch(`${baseUrl}/auth/me`);
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('returns the real signed-in user', async () => {
      await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
      const session = await registerTestUser(baseUrl, 'me@example.com');
      const res = await fetch(`${baseUrl}/auth/me`, withCookie({}, session.cookie));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ id: session.userId, email: 'me@example.com' });
    });
  });

  describe('POST /auth/logout', () => {
    it('really revokes the session — a subsequent request with the same cookie is rejected', async () => {
      await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
      const session = await registerTestUser(baseUrl);

      const logoutRes = await fetch(`${baseUrl}/auth/logout`, withCookie({ method: 'POST' }, session.cookie));
      expect(logoutRes.status).toBe(204);
      expect(logoutRes.headers.get('set-cookie')).toMatch(/Max-Age=0/);

      const afterLogout = await fetch(`${baseUrl}/auth/me`, withCookie({}, session.cookie));
      expect(afterLogout.status).toBe(401);
    });
  });

  it('a session with a tampered/invalid cookie value is rejected the same as no session at all', async () => {
    await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
    const res = await fetch(`${baseUrl}/auth/me`, { headers: { cookie: 'avs_session=not-a-real-session-id' } });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
