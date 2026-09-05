/**
 * docs/16_SECURITY_SPEC.md "Do not log secrets or raw credentials" / docs/03
 * §12 "Secret leakage via logs/error payloads" (BUILD 18 hardening). Every
 * provider adapter/engine builds its error message by interpolating the raw
 * upstream HTTP response body — that body reaches BOTH the structured log
 * (`Logger`, which only redacts by known object-key name, not arbitrary
 * string content) and the client-facing `ErrorEnvelope` (`DomainError.
 * toEnvelope()`). A misbehaving or misconfigured upstream provider could echo
 * back a request header, an internal path, or (in the worst case) a key
 * fragment inside that body.
 *
 * This is a heuristic, not an exhaustive secret scanner: it truncates to a
 * bounded length (bounding overall exposure and log/response size) and
 * strips any long opaque token-shaped substring (API keys/session tokens are
 * almost always long random-looking strings — this catches the overwhelming
 * common case without needing to know every provider's exact key format).
 * It does not understand structured secrets embedded in JSON keys the way
 * `Logger`'s redaction does — this is deliberately the *last* line of
 * defense for raw, un-keyed provider text, not a replacement for it.
 */
const MAX_SANITIZED_LENGTH = 300;
const LONG_OPAQUE_TOKEN_PATTERN = /[A-Za-z0-9_-]{24,}/g;

export function sanitizeProviderErrorBody(rawBody: string): string {
  const truncated = rawBody.length > MAX_SANITIZED_LENGTH ? `${rawBody.slice(0, MAX_SANITIZED_LENGTH)}…` : rawBody;
  return truncated.replace(LONG_OPAQUE_TOKEN_PATTERN, '[REDACTED]');
}
