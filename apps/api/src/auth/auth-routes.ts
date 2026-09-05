import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DomainError } from '@avs/shared';
import type { AuthenticatedUser, User } from '@avs/project-core';
import type { AppContext } from '../app-context.js';
import { readBody } from '../read-body.js';
import { sendJson } from '../http-utils.js';
import { loginRequestSchema, registerRequestSchema } from '../schemas.js';
import { hashPassword, verifyPassword } from './password.js';
import { buildClearSessionCookie, buildSessionCookie, newSession, parseCookies, SESSION_COOKIE_NAME } from './session.js';

const MAX_AUTH_BODY_BYTES = 4 * 1024;

function parseJsonBody(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new DomainError({ code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.', retryable: false });
  }
}

/** Constant-time-ish comparison for the shared registration secret — avoids a length/prefix timing signal, same reasoning as password verification. */
function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * RELEASE 02 — real accounts, gated by a shared `REGISTRATION_SECRET`
 * (docs/16 "private deployment," never a public open-registration endpoint):
 * unset, registration is entirely disabled (deny-by-default, same graceful-
 * degradation-toward-safety pattern as every optional secret in this
 * codebase). On success, immediately signs the new account in (creates a
 * real session, sets the cookie) — no separate "verify your email" step
 * exists to gate on.
 */
export async function handleRegister(
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext,
): Promise<void> {
  if (!context.registrationSecret) {
    throw new DomainError({
      code: 'REGISTRATION_DISABLED',
      message: 'Registration is not enabled on this deployment.',
      retryable: false,
    });
  }

  const raw = await readBody(req, MAX_AUTH_BODY_BYTES);
  const result = registerRequestSchema.safeParse(parseJsonBody(raw));
  if (!result.success) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid registration request: ${result.error.issues.map((i) => i.message).join('; ')}`,
      retryable: false,
    });
  }

  if (!secretsMatch(result.data.registrationSecret, context.registrationSecret)) {
    throw new DomainError({ code: 'REGISTRATION_FORBIDDEN', message: 'Invalid registration secret.', retryable: false });
  }

  const passwordHash = await hashPassword(result.data.password);
  const user: User = {
    id: randomUUID() as User['id'],
    email: result.data.email,
    passwordHash,
    createdAt: new Date().toISOString() as User['createdAt'],
  };
  const created = await context.userRepository.create(user);

  const session = newSession(created.id);
  await context.sessionRepository.create(session);

  const authenticated: AuthenticatedUser = { id: created.id, email: created.email };
  sendJson(res, 201, authenticated, {
    'set-cookie': buildSessionCookie(session.id, new Date(session.expiresAt), context.cookieSecure),
  });
}

/** Never reveals whether the email or the password was wrong — one generic error either way (docs/16 safe auth errors). */
export async function handleLogin(req: IncomingMessage, res: ServerResponse, context: AppContext): Promise<void> {
  const raw = await readBody(req, MAX_AUTH_BODY_BYTES);
  const result = loginRequestSchema.safeParse(parseJsonBody(raw));
  if (!result.success) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid login request: ${result.error.issues.map((i) => i.message).join('; ')}`,
      retryable: false,
    });
  }

  const invalidCredentials = () =>
    new DomainError({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.', retryable: false });

  const user = await context.userRepository.getByEmail(result.data.email);
  if (!user) throw invalidCredentials();

  const valid = await verifyPassword(result.data.password, user.passwordHash);
  if (!valid) throw invalidCredentials();

  const session = newSession(user.id);
  await context.sessionRepository.create(session);

  const authenticated: AuthenticatedUser = { id: user.id, email: user.email };
  sendJson(res, 200, authenticated, {
    'set-cookie': buildSessionCookie(session.id, new Date(session.expiresAt), context.cookieSecure),
  });
}

export async function handleLogout(req: IncomingMessage, res: ServerResponse, context: AppContext): Promise<void> {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (sessionId) await context.sessionRepository.deleteById(sessionId);

  res.writeHead(204, { 'set-cookie': buildClearSessionCookie(context.cookieSecure) });
  res.end();
}

/** Lets `apps/web` ask "am I signed in, and as whom" without guessing from response codes on some other route. `user` is already resolved by server.ts's central `requireAuth()` call before dispatching here. */
export function handleMe(res: ServerResponse, user: AuthenticatedUser): void {
  sendJson(res, 200, user);
}
