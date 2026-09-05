import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Real password hashing — RELEASE 02. `scrypt` (Node's built-in, memory-hard
 * KDF) needs no new dependency, same "zero external vendor" pattern already
 * established for storage (BUILD 18). Never store or compare plaintext.
 */
const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

/** Timing-safe: a wrong-length/malformed stored hash returns false rather than throwing or short-circuiting on string length. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const storedBuf = Buffer.from(hashHex, 'hex');
  if (storedBuf.length !== derivedKey.length) return false;
  return timingSafeEqual(derivedKey, storedBuf);
}
