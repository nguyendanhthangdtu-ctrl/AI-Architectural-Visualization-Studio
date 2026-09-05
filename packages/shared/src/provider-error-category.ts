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
 *
 * BUILD 25 (Multi-Model Image Engine / Nano Banana 2) — split `403` out of
 * `PROVIDER_AUTH_FAILED` into its own `PROVIDER_FORBIDDEN` (a real, valid
 * credential lacking permission for this specific model/action is a
 * different operator fix than an invalid/missing credential), added
 * `PROVIDER_MODEL_NOT_FOUND` (404 — a real, separate condition from a
 * generic bad response: the wrong model id was requested), and split
 * `PROVIDER_RATE_LIMITED` into it and a new `PROVIDER_QUOTA_EXCEEDED` when
 * the provider's own 429 body says so. This distinction is not theoretical:
 * a real live Gemini call in this project hit exactly this — a 429 whose
 * body read "You exceeded your current quota, please check your plan and
 * billing details" — which is a fundamentally different situation from a
 * transient rate-limit window (retrying a quota-exhausted request
 * immediately can never succeed; retrying a rate-limited one often does).
 * No existing test asserted 401 vs 403 vs 404 classification before this
 * change (verified), so this is a safe, non-breaking refinement.
 */
export type ProviderErrorCategory =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_FORBIDDEN'
  | 'PROVIDER_MODEL_NOT_FOUND'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_QUOTA_EXCEEDED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_INVALID_REQUEST'
  | 'PROVIDER_CONTENT_REJECTED'
  | 'PROVIDER_BAD_RESPONSE'
  | 'OUTPUT_INVALID'
  | 'ASSET_PERSISTENCE_FAILED'
  | 'INTERNAL_ERROR';

/**
 * Maps a real upstream HTTP status (+ optionally its raw response body text,
 * for the 429 quota-vs-rate-limit split above) to a category + whether it's
 * safe to let a caller retry. Conservative: an unrecognized 4xx defaults to
 * `PROVIDER_INVALID_REQUEST` (not retryable — retrying an unchanged request
 * against the same rejection is never correct), an unrecognized 2xx/3xx that
 * still reached error-handling defaults to `PROVIDER_BAD_RESPONSE` (the
 * response shape itself was wrong, not the HTTP layer). `rawMessage` is
 * optional and purely additive — every existing single-argument call site
 * keeps its exact prior behavior for every status except 429, where it now
 * defaults to `PROVIDER_RATE_LIMITED` (unchanged) rather than ever guessing
 * quota without evidence.
 */
export function classifyProviderHttpStatus(status: number, rawMessage?: string): { category: ProviderErrorCategory; retryable: boolean } {
  if (status === 401) return { category: 'PROVIDER_AUTH_FAILED', retryable: false };
  if (status === 403) return { category: 'PROVIDER_FORBIDDEN', retryable: false };
  if (status === 404) return { category: 'PROVIDER_MODEL_NOT_FOUND', retryable: false };
  if (status === 429) {
    const isQuotaExhaustion = typeof rawMessage === 'string' && /quota/i.test(rawMessage);
    // Retrying an immediately-repeated request can never help a real quota/billing
    // exhaustion (it will only fail again); a genuine rate-limit window often clears
    // within the adapter's own short bounded backoff, so that case stays retryable.
    return isQuotaExhaustion ? { category: 'PROVIDER_QUOTA_EXCEEDED', retryable: false } : { category: 'PROVIDER_RATE_LIMITED', retryable: true };
  }
  if (status === 408) return { category: 'PROVIDER_TIMEOUT', retryable: true };
  if (status >= 500) return { category: 'PROVIDER_UNAVAILABLE', retryable: true };
  if (status === 400 || status === 422) return { category: 'PROVIDER_INVALID_REQUEST', retryable: false };
  return { category: 'PROVIDER_BAD_RESPONSE', retryable: false };
}
