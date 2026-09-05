/**
 * BUILD 21 (Production AI Provider Integration) — a standardized error
 * taxonomy every AI provider adapter classifies its failures into, carried
 * on `ErrorEnvelope.providerCode` (a field `errors.ts` already reserved for
 * exactly this, previously unused). This is additive, not a rename: each
 * adapter's existing top-level `code` (e.g. `NANO_BANANA_PROVIDER_ERROR`,
 * `VEO_PROVIDER_ERROR`) is unchanged — every existing test/error-handling
 * mapping (`apps/api/src/error-handling.ts`'s `HTTP_STATUS_BY_CODE`) keeps
 * working exactly as before. `providerCode` gives callers (logs, dashboards,
 * a future ops UI) one common vocabulary to group failures by *kind* across
 * six otherwise-independent adapters, without conflating "Nano Banana is
 * down" with "ChatGPT Image is down" — the top-level `code` still says
 * which provider; `providerCode` says what kind of failure.
 */
export type ProviderErrorCategory =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_INVALID_REQUEST'
  | 'PROVIDER_CONTENT_REJECTED'
  | 'PROVIDER_BAD_RESPONSE'
  | 'OUTPUT_INVALID'
  | 'ASSET_PERSISTENCE_FAILED'
  | 'INTERNAL_ERROR';

/**
 * Maps a real upstream HTTP status to a category + whether it's safe to let
 * a caller retry. Conservative: an unrecognized 4xx defaults to
 * `PROVIDER_INVALID_REQUEST` (not retryable — retrying an unchanged request
 * against the same rejection is never correct), an unrecognized 2xx/3xx that
 * still reached error-handling defaults to `PROVIDER_BAD_RESPONSE` (the
 * response shape itself was wrong, not the HTTP layer).
 */
export function classifyProviderHttpStatus(status: number): { category: ProviderErrorCategory; retryable: boolean } {
  if (status === 401 || status === 403) return { category: 'PROVIDER_AUTH_FAILED', retryable: false };
  if (status === 429) return { category: 'PROVIDER_RATE_LIMITED', retryable: true };
  if (status === 408) return { category: 'PROVIDER_TIMEOUT', retryable: true };
  if (status >= 500) return { category: 'PROVIDER_UNAVAILABLE', retryable: true };
  if (status === 400 || status === 422) return { category: 'PROVIDER_INVALID_REQUEST', retryable: false };
  return { category: 'PROVIDER_BAD_RESPONSE', retryable: false };
}
