import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { DomainError } from '@avs/shared';
import type { AuthenticatedUser, Session } from '@avs/project-core';
import type { AppContext } from '../app-context.js';

/**
 * Real, server-side, revocable sessions — RELEASE 02. The session id is a
 * 256-bit random opaque token (never a self-verifying JWT — see `Session`'s
 * own doc comment in packages/project-core/src/user.ts): every request
 * re-checks the `SessionRepository` row, so logout/expiry are real and
 * immediate, not "valid until it says otherwise."
 */
export const SESSION_COOKIE_NAME = 'avs_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function generateSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/** Minimal, real `Cookie` header parser — no new dependency for something this small. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

/**
 * `SameSite=Strict` is safe here (not merely convenient) because this app's
 * supported architecture puts `apps/web` and `apps/api` behind the same
 * origin — a same-origin dev proxy (`apps/web/vite.config.ts`) and, in
 * production, the same reverse proxy that already has to exist for TLS
 * (docs/03 §11) routing `/api/*` to this server. Under that shape, every
 * real request is same-site, so `Strict` costs nothing while still ruling
 * out the cross-site request forgery class entirely — stricter than `Lax`
 * without breaking the one flow this app actually has.
 */
export function buildSessionCookie(sessionId: string, expiresAt: Date, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${sessionId}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearSessionCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'HttpOnly', 'Path=/', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function unauthenticated(): DomainError {
  return new DomainError({ code: 'UNAUTHENTICATED', message: 'Sign in required.', retryable: false });
}

/**
 * The one real authorization boundary every protected route calls through —
 * never trusts a client-supplied user id (docs/16): the user comes only from
 * a session row this server itself created and can still find, looked up by
 * the opaque cookie value, nothing else. Deletes an expired session row on
 * the way out (real cleanup, not just a rejected request) rather than
 * leaving it to accumulate.
 */
export async function requireAuth(context: AppContext, req: IncomingMessage): Promise<AuthenticatedUser> {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (!sessionId) throw unauthenticated();

  const session = await context.sessionRepository.getById(sessionId);
  if (!session) throw unauthenticated();

  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await context.sessionRepository.deleteById(sessionId);
    throw unauthenticated();
  }

  const user = await context.userRepository.getById(session.userId);
  if (!user) throw unauthenticated();

  return { id: user.id, email: user.email };
}

export function newSession(userId: Session['userId']): Session {
  const now = new Date();
  return {
    id: generateSessionId(),
    userId,
    createdAt: now.toISOString() as Session['createdAt'],
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString() as Session['expiresAt'],
  };
}
