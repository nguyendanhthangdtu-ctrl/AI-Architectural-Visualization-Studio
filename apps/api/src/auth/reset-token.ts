import { createHash, randomBytes } from 'node:crypto';

/**
 * BUILD 19 (Account Recovery) — the raw token is a 256-bit random value,
 * cryptographically unguessable; only its SHA-256 hash is ever stored
 * (`PasswordResetTokenRepository`). Unlike a password (`hashPassword()` in
 * password.ts, scrypt), this is already maximum-entropy random, never
 * user-chosen — a fast, deterministic hash is correct here, not a slow KDF:
 * the token IS the secret, hashing it is purely "don't hand over a directly
 * replayable value if the DB is ever read," the same reasoning
 * `SqliteSessionRepository`'s session ids apply by being random in the first
 * place (a session id isn't hashed at rest — a reset token is, specifically
 * because it's also emailed, a channel a session id never crosses).
 */
export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
