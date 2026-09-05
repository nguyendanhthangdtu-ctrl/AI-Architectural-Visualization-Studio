import { randomUUID } from 'node:crypto';

/**
 * RELEASE 02 — every route except `/health`, `/metrics`, `/auth/register`,
 * and `/auth/login` now requires a real session. Every existing route test
 * (BUILD 06-18) needs to register a real account and carry its real session
 * cookie on every subsequent request — this is that shared step, not a
 * mock: it exercises the actual `POST /auth/register` endpoint, real scrypt
 * hashing, a real session row.
 */
export const TEST_REGISTRATION_SECRET = 'test-registration-secret-do-not-use-in-prod';
export const TEST_PASSWORD = 'correct horse battery staple 42';

export interface TestSession {
  cookie: string;
  userId: string;
  email: string;
}

export async function registerTestUser(baseUrl: string, email = `user-${randomUUID()}@example.com`): Promise<TestSession> {
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD, registrationSecret: TEST_REGISTRATION_SECRET }),
  });
  if (res.status !== 201) {
    throw new Error(`registerTestUser failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('registerTestUser: response did not set a session cookie');
  const cookie = setCookie.split(';')[0]!;
  const user = (await res.json()) as { id: string; email: string };
  return { cookie, userId: user.id, email: user.email };
}

/** Merges a session cookie into a fetch `init` object without clobbering any other headers already present. */
export function withCookie(init: RequestInit, cookie: string): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string> | undefined), cookie } };
}
