import type { Timestamp, UserId } from '@avs/shared';

/**
 * Real account model — RELEASE 02 (Security & Production Access Hardening).
 * `passwordHash` is a salted scrypt digest (`apps/api/src/auth/password.ts`),
 * never a plaintext password — this type is never sent to a client; routes
 * always map to `AuthenticatedUser` first.
 */
export interface User {
  id: UserId;
  email: string;
  passwordHash: string;
  createdAt: Timestamp;
}

/** The safe, client-facing view of a `User` — no `passwordHash`, ever. */
export interface AuthenticatedUser {
  id: UserId;
  email: string;
}

/**
 * A real, server-side, revocable session — the session id itself is the
 * unguessable secret (256 bits of randomness, `apps/api/src/auth/session.ts`),
 * never a self-describing/self-verifying token (e.g. a signed JWT): every
 * request re-checks this row, so revocation (logout, expiry) is real and
 * immediate, not "valid until it says otherwise."
 */
export interface Session {
  id: string;
  userId: UserId;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}
