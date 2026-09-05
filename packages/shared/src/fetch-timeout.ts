/**
 * BUILD 19 Phase 3 (Live AI Provider Verification) — every provider
 * adapter/engine's outbound `fetch()` previously had no timeout: a hung
 * upstream connection could hold a request (and, before it fails, its
 * rate-limit slot) open indefinitely. `AbortController` is available in both
 * Node and browsers, so this stays safe to keep in `packages/shared`
 * alongside the other pure, dependency-free helpers here (rate-limiter.ts,
 * provider-error-sanitizer.ts).
 */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;

/** Thrown in place of whatever `fetchFn` itself would have thrown on abort — callers check `error.name === 'ProviderTimeoutError'` to classify it distinctly from a generic network failure. */
export class ProviderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms.`);
    this.name = 'ProviderTimeoutError';
  }
}

export async function fetchWithTimeout(
  fetchFn: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
