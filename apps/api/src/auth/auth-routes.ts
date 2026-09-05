import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DomainError } from '@avs/shared';
import type { Timestamp } from '@avs/shared';
import type { AuthenticatedUser, User } from '@avs/project-core';
import type { AppContext } from '../app-context.js';
import { readBody } from '../read-body.js';
import { sendJson } from '../http-utils.js';
import {
  confirmPasswordResetRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  requestPasswordResetRequestSchema,
} from '../schemas.js';
import { hashPassword, verifyPassword } from './password.js';
import { generateResetToken, hashResetToken } from './reset-token.js';
import { buildClearSessionCookie, buildSessionCookie, newSession, parseCookies, SESSION_COOKIE_NAME } from './session.js';

const MAX_AUTH_BODY_BYTES = 4 * 1024;
/** 1 hour — short-lived by design (Account Recovery, BUILD 19). Real, not test-configurable via env: `AppContext.passwordResetTokenTtlMs` exists solely so tests can exercise real expiry with a real (tiny) delay instead of mocking time around a live HTTP server. */
export const DEFAULT_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

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

const GENERIC_RESET_REQUESTED_RESPONSE = {
  message: 'If an account with that email address exists, a password reset link has been sent.',
};

/**
 * BUILD 19 (Account Recovery) — always answers with the exact same generic
 * message and status, whether or not the email belongs to a real account
 * (docs/16 "prevent account enumeration"/"generic responses for unknown
 * email addresses"): the only thing that differs based on the account's
 * real existence is a side effect the caller never observes (whether an
 * email was actually queued). The real token is only ever placed in the
 * email body handed to `EmailSender` — never logged, never returned in this
 * response.
 */
export async function handleRequestPasswordReset(req: IncomingMessage, res: ServerResponse, context: AppContext): Promise<void> {
  const raw = await readBody(req, MAX_AUTH_BODY_BYTES);
  const result = requestPasswordResetRequestSchema.safeParse(parseJsonBody(raw));
  if (!result.success) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid password reset request: ${result.error.issues.map((i) => i.message).join('; ')}`,
      retryable: false,
    });
  }

  const user = await context.userRepository.getByEmail(result.data.email);
  if (user) {
    const rawToken = generateResetToken();
    const now = new Date();
    const tokenId = hashResetToken(rawToken);
    await context.passwordResetTokenRepository.create({
      id: tokenId,
      userId: user.id,
      createdAt: now.toISOString() as Timestamp,
      expiresAt: new Date(now.getTime() + context.passwordResetTokenTtlMs).toISOString() as Timestamp,
      usedAt: null,
    });

    // BUILD 22 — a real vendor can genuinely fail (auth, rate limit, timeout)
    // where `InMemoryEmailSender` never could. That failure must never
    // change this endpoint's response: `emailSender.send()` is only ever
    // called for a KNOWN account (never for an unknown one, a few lines
    // above), so letting a send failure escape as an error response here
    // would itself be an enumeration side-channel — "this request failed
    // differently" would mean "this account exists." Log it (safe,
    // structured, no secret/token/body) and still answer with the exact
    // same generic response either way.
    const sendStartedAt = Date.now();
    try {
      const sendResult = await context.emailSender.send({
        to: user.email,
        subject: 'Reset your password',
        body: [
          'A password reset was requested for your account.',
          `Reset token (expires in 1 hour, single use): ${rawToken}`,
          "If you didn't request this, you can safely ignore this email.",
        ].join('\n'),
        idempotencyKey: tokenId,
      });
      context.logger.info('Password reset email attempt completed', {
        latencyMs: Date.now() - sendStartedAt,
        outcome: sendResult.status,
      });
    } catch (error) {
      context.logger.error('Password reset email attempt failed', {
        latencyMs: Date.now() - sendStartedAt,
        code: error instanceof DomainError ? error.code : 'INTERNAL_ERROR',
        providerCode: error instanceof DomainError ? error.providerCode : undefined,
      });
    }
  }

  sendJson(res, 202, GENERIC_RESET_REQUESTED_RESPONSE);
}

function invalidOrExpiredResetToken(): DomainError {
  return new DomainError({
    code: 'INVALID_OR_EXPIRED_RESET_TOKEN',
    message: 'This password reset link is invalid or has expired.',
    retryable: false,
  });
}

/**
 * Consumes a reset token exactly once: rejects unknown/expired/already-used
 * tokens with the same generic error either way (never reveals which),
 * updates the real password hash, marks the token used (single-use, not
 * deletable-and-reusable), and revokes every existing session for that
 * user — a password reset is exactly the moment a previously-issued session
 * (e.g. from a compromised device) must stop working.
 */
export async function handleConfirmPasswordReset(req: IncomingMessage, res: ServerResponse, context: AppContext): Promise<void> {
  const raw = await readBody(req, MAX_AUTH_BODY_BYTES);
  const result = confirmPasswordResetRequestSchema.safeParse(parseJsonBody(raw));
  if (!result.success) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid password reset confirmation: ${result.error.issues.map((i) => i.message).join('; ')}`,
      retryable: false,
    });
  }

  const tokenHash = hashResetToken(result.data.token);
  const record = await context.passwordResetTokenRepository.getById(tokenHash);
  if (!record || record.usedAt || new Date(record.expiresAt).getTime() < Date.now()) {
    throw invalidOrExpiredResetToken();
  }

  const newPasswordHash = await hashPassword(result.data.newPassword);
  await context.userRepository.updatePasswordHash(record.userId, newPasswordHash);
  await context.passwordResetTokenRepository.markUsed(tokenHash, new Date().toISOString());
  await context.sessionRepository.deleteAllForUser(record.userId);

  res.writeHead(204);
  res.end();
}
