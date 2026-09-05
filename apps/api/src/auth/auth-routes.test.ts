import { describe, expect, it, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.js';
import { createAppContext, type AppContext } from '../app-context.js';
import { InMemoryEmailSender } from './email-sender.js';
import { registerTestUser, TEST_PASSWORD, TEST_REGISTRATION_SECRET, withCookie } from '../test-helpers/auth.js';

/** Extracts the raw reset token this test's own `InMemoryEmailSender` captured — the only place the token ever appears outside the request itself. */
function extractResetToken(body: string): string {
  const match = /Reset token \(expires in 1 hour, single use\): (\S+)/.exec(body);
  if (!match) throw new Error(`Could not find a reset token in email body: ${body}`);
  return match[1]!;
}

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

  describe('Password reset (BUILD 19 Account Recovery)', () => {
    async function startWithEmailSender() {
      const emailSender = new InMemoryEmailSender();
      const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET, emailSender });
      await start(context);
      return { context, emailSender };
    }

    it('completes the full real flow: request -> real token -> confirm -> old password rejected, new one works', async () => {
      const { emailSender } = await startWithEmailSender();
      const session = await registerTestUser(baseUrl, 'reset@example.com');
      void session; // establishes the account; the reset flow itself never uses this session

      const requestRes = await fetch(`${baseUrl}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'reset@example.com' }),
      });
      expect(requestRes.status).toBe(202);
      expect(emailSender.sent).toHaveLength(1);
      expect(emailSender.sent[0]!.to).toBe('reset@example.com');
      const token = extractResetToken(emailSender.sent[0]!.body);

      const confirmRes = await fetch(`${baseUrl}/auth/password-reset/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: 'a-brand-new-real-password' }),
      });
      expect(confirmRes.status).toBe(204);

      const oldPasswordLogin = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'reset@example.com', password: TEST_PASSWORD }),
      });
      expect(oldPasswordLogin.status).toBe(401);

      const newPasswordLogin = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'reset@example.com', password: 'a-brand-new-real-password' }),
      });
      expect(newPasswordLogin.status).toBe(200);
    });

    it('invalidates every existing session on a successful reset', async () => {
      const { emailSender } = await startWithEmailSender();
      const session = await registerTestUser(baseUrl, 'sessions@example.com');
      expect((await fetch(`${baseUrl}/auth/me`, withCookie({}, session.cookie))).status).toBe(200);

      await fetch(`${baseUrl}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'sessions@example.com' }),
      });
      const token = extractResetToken(emailSender.sent[0]!.body);
      await fetch(`${baseUrl}/auth/password-reset/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: 'a-brand-new-real-password' }),
      });

      const afterReset = await fetch(`${baseUrl}/auth/me`, withCookie({}, session.cookie));
      expect(afterReset.status).toBe(401);
    });

    it('gives the exact same generic response for a known and an unknown email (enumeration protection), and sends no email for the unknown one', async () => {
      const { emailSender } = await startWithEmailSender();
      await registerTestUser(baseUrl, 'known@example.com');

      const knownRes = await fetch(`${baseUrl}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'known@example.com' }),
      });
      const unknownRes = await fetch(`${baseUrl}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'nobody-real@example.com' }),
      });

      expect(knownRes.status).toBe(unknownRes.status);
      expect(await knownRes.json()).toEqual(await unknownRes.json());
      expect(emailSender.sent).toHaveLength(1); // only the known address actually got one
    });

    it('BUILD 22: a real email vendor failure never changes the response — that would itself leak account existence', async () => {
      // A real vendor (unlike InMemoryEmailSender) can genuinely throw (auth
      // failure, rate limit, timeout). Since send() is only ever called for
      // a KNOWN account, an unhandled throw reaching the client here would
      // be a real enumeration side-channel: "this request errored
      // differently" would mean "this account exists."
      const failingEmailSender = {
        send: async () => {
          throw new Error('simulated vendor outage');
        },
      };
      const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET, emailSender: failingEmailSender });
      await start(context);
      await registerTestUser(baseUrl, 'known-with-failing-vendor@example.com');

      const knownRes = await fetch(`${baseUrl}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'known-with-failing-vendor@example.com' }),
      });
      const unknownRes = await fetch(`${baseUrl}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'still-nobody-real@example.com' }),
      });

      expect(knownRes.status).toBe(202);
      expect(unknownRes.status).toBe(202);
      expect(await knownRes.json()).toEqual(await unknownRes.json());
    });

    it('rejects an unknown reset token with a generic error, never revealing why', async () => {
      await startWithEmailSender();
      const res = await fetch(`${baseUrl}/auth/password-reset/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-real-token', newPassword: 'a-brand-new-real-password' }),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: 'INVALID_OR_EXPIRED_RESET_TOKEN' });
    });

    it('rejects an expired reset token', async () => {
      // A real, tiny TTL + a real delay — proves the actual expiry check, not a mocked clock
      // (mocking timers around a live HTTP server risks hanging on real socket I/O).
      const emailSender = new InMemoryEmailSender();
      await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET, emailSender, passwordResetTokenTtlMs: 20 }));
      await registerTestUser(baseUrl, 'expired@example.com');
      await fetch(`${baseUrl}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'expired@example.com' }),
      });
      const token = extractResetToken(emailSender.sent[0]!.body);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const res = await fetch(`${baseUrl}/auth/password-reset/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: 'a-brand-new-real-password' }),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: 'INVALID_OR_EXPIRED_RESET_TOKEN' });
    });

    it('rejects reusing an already-consumed token (single-use)', async () => {
      const { emailSender } = await startWithEmailSender();
      await registerTestUser(baseUrl, 'reuse@example.com');
      await fetch(`${baseUrl}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'reuse@example.com' }),
      });
      const token = extractResetToken(emailSender.sent[0]!.body);

      const firstUse = await fetch(`${baseUrl}/auth/password-reset/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: 'first-new-password-here' }),
      });
      expect(firstUse.status).toBe(204);

      const secondUse = await fetch(`${baseUrl}/auth/password-reset/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: 'second-new-password-here' }),
      });
      expect(secondUse.status).toBe(400);
      await expect(secondUse.json()).resolves.toMatchObject({ code: 'INVALID_OR_EXPIRED_RESET_TOKEN' });
    });

    it('rejects a new password shorter than 8 characters', async () => {
      const { emailSender } = await startWithEmailSender();
      await registerTestUser(baseUrl, 'short@example.com');
      await fetch(`${baseUrl}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'short@example.com' }),
      });
      const token = extractResetToken(emailSender.sent[0]!.body);

      const res = await fetch(`${baseUrl}/auth/password-reset/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: 'short' }),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('never leaks the raw reset token or a stack trace in any response', async () => {
      const { emailSender } = await startWithEmailSender();
      await registerTestUser(baseUrl, 'noleak@example.com');
      const requestRes = await fetch(`${baseUrl}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'noleak@example.com' }),
      });
      const requestBody = (await requestRes.json()) as Record<string, unknown>;
      expect(Object.keys(requestBody)).not.toContain('stack');
      const token = extractResetToken(emailSender.sent[0]!.body);
      expect(JSON.stringify(requestBody)).not.toContain(token);
    });

    it('is rate-limited', async () => {
      await startWithEmailSender();
      const attempts = await Promise.all(
        Array.from({ length: 8 }, () =>
          fetch(`${baseUrl}/auth/password-reset/request`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'ratelimited@example.com' }),
          }),
        ),
      );
      expect(attempts.some((r) => r.status === 429)).toBe(true);
    });
  });
});
