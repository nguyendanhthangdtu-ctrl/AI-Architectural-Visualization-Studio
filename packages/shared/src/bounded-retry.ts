/**
 * BUILD 23 (Real AI Provider Integration) — extracted from BUILD 22's
 * `resend-email-sender.ts` (which had its own inline bounded-retry loop) so
 * both email and image-generation adapters share one real, tested retry
 * mechanism rather than duplicating it (CLAUDE.md rule 9). Never retries
 * unconditionally — `isRetryable` decides per call, so a caller stays in
 * full control of which failures are safe to repeat (auth/validation/
 * permanent failures should always return `false`).
 */
export interface BoundedRetryOptions {
  /** Total attempts, including the first — default 3. */
  maxAttempts?: number;
  /** Backoff before attempt N+1 is `backoffMs * N` — default 200ms. */
  backoffMs?: number;
  isRetryable: (error: unknown) => boolean;
}

export async function withBoundedRetry<T>(fn: (attempt: number) => Promise<T>, options: BoundedRetryOptions): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? 200;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (!options.isRetryable(error) || attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
    }
  }
  // Unreachable — the loop above always either returns or throws — but keeps TypeScript's control-flow analysis satisfied.
  throw lastError;
}
