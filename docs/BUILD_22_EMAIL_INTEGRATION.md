# BUILD 22 — Real Email Vendor Integration

Companion to `docs/03_TECHNICAL_ARCHITECTURE.md` §36 (what changed and why) and BUILD 19's
`email-sender.ts` (the original boundary this build extends, never replaces).

## 1. Architecture

```
apps/api/src/auth/auth-routes.ts
  handleRequestPasswordReset()
    → context.emailSender.send({ to, subject, body, idempotencyKey }): Promise<EmailSendResult>
                                    │
                     ┌──────────────┴──────────────┐
                     │                              │
          InMemoryEmailSender              createResendEmailSender()
          (apps/api/src/auth/               (apps/api/src/auth/
           email-sender.ts)                  resend-email-sender.ts)
          — dev/test default,                — real vendor, selected by
            never delivers anything            EMAIL_PROVIDER=resend
```

`EmailSender` (`apps/api/src/auth/email-sender.ts`) is the same interface BUILD 19 already
established — extended, not replaced: `EmailMessage` gained optional `html`/`replyTo`/
`idempotencyKey` fields, and `send()` now resolves to a real `EmailSendResult` (`{status:
'sent', providerMessageId?}`) instead of `void`. Both changes are backward compatible — the
one existing caller (`handleRequestPasswordReset`) never inspected the old `void` return, and
every existing field it already sent (`to`, `subject`, `body`) is unchanged.

`validateEmailMessage()` is a new, shared validation function both `InMemoryEmailSender` and
`ResendEmailSender` call before doing anything vendor-specific (CLAUDE.md rule 9 — never
duplicated per-adapter): real recipient-format validation (zod's `.email()`, the same
validator `schemas.ts` already uses for registration/login), subject/body non-empty and
size-capped (200 / 100,000 chars).

## 2. Provider selection

`EMAIL_PROVIDER` (`packages/shared/src/env.ts`) is a real, validated selector — `z.literal
('resend').optional()`, i.e. exactly one real vendor or unset. Unset (the default) means no
real vendor is wired: `app-context.ts` falls back to `InMemoryEmailSender`, exactly BUILD 19's
existing behavior, unchanged. This follows the same "one real vendor deliberately, not
several" reasoning BUILD 21 already applied to AI providers — a second vendor (SES,
SendGrid, SMTP) would implement this exact same `EmailSender` interface without any other
code changing, but building one without a concrete reason to choose it would be premature.

**Why Resend**: a single-endpoint JSON REST API (`POST https://api.resend.com/emails`, Bearer
auth), needing zero additional infrastructure (no SMTP relay to operate, no AWS account to
provision) and the closest real match to every adapter already in this codebase (raw
`fetch()`, no vendor SDK — docs/10's existing convention). Validated against Resend's public
API docs (accessed 2026-09-05): `https://resend.com/docs/api-reference/emails/send-email`,
`https://resend.com/docs/api-reference/errors`.

## 3. Configuration variables

| Variable | Required when | Purpose |
|---|---|---|
| `EMAIL_PROVIDER` | — | `resend` or unset; unset = `InMemoryEmailSender` |
| `EMAIL_FROM` | `EMAIL_PROVIDER=resend` | The verified Resend sender identity |
| `EMAIL_REPLY_TO` | never | Optional default Reply-To |
| `RESEND_API_KEY` | `EMAIL_PROVIDER=resend` | Real vendor credential — never logged, never returned |

Fail-fast (`env.ts`'s `superRefine`, same pattern BUILD 19 established for `TRUST_HTTPS`/
`ASSET_URL_SIGNING_SECRET`): declaring `EMAIL_PROVIDER=resend` without `RESEND_API_KEY` or
`EMAIL_FROM` refuses to start the server, rather than silently keeping the never-delivers
in-memory sender in what the operator declared a real-email deployment. Every other
combination (including the fully-unset default) starts cleanly — BUILD 02's bootstrap
guarantee (no secret required to start locally) is preserved.

## 4. Local/test vs. production behavior

- **Local/test** (no `EMAIL_PROVIDER`): `InMemoryEmailSender` records every send in an
  in-process array a test can inspect directly (`sender.sent`) — this is how the entire
  password-reset flow is proven end-to-end in `auth-routes.test.ts` without any real vendor.
- **Production** (`EMAIL_PROVIDER=resend`): a real HTTP call to Resend, real timeout (60s
  default, `fetchWithTimeout` — the same helper every AI adapter already uses), a bounded
  retry (see §6), and a real `Idempotency-Key` header derived from the password-reset token's
  own hash (a stable, unique-per-request value already computed before the send).

## 5. Error handling

Every Resend failure is caught and re-thrown as `DomainError({code: 'EMAIL_PROVIDER_ERROR'})`
— never a raw vendor exception, stack trace, or response body reaching a caller.
`providerCode` carries BUILD 21's standardized taxonomy (`classifyProviderHttpStatus()`,
reused unchanged): `PROVIDER_AUTH_FAILED` (401/403, not retryable), `PROVIDER_RATE_LIMITED`
(429, retryable), `PROVIDER_TIMEOUT` (408 or a real `fetchWithTimeout` abort, retryable),
`PROVIDER_UNAVAILABLE` (5xx, retryable), `PROVIDER_INVALID_REQUEST` (400/422, not retryable),
`PROVIDER_BAD_RESPONSE` (anything else). `PROVIDER_NOT_CONFIGURED` (503) is thrown
synchronously, before any network call, whenever `RESEND_API_KEY` is absent — the same
runtime guard every AI adapter already carries, defense-in-depth alongside `env.ts`'s
startup-time fail-fast.

**A critical fix this build made, not merely a new feature**: `handleRequestPasswordReset()`
now catches any `emailSender.send()` failure and STILL returns the exact same generic 202
response either way (logging the failure server-side, safely, instead). Before this build,
`send()` could only ever be `InMemoryEmailSender`, which never throws — so a real vendor
failure escaping as an error response was a latent, previously-impossible bug that only
became reachable once a real vendor that CAN fail was wired in. Since `send()` is only ever
called for a KNOWN account (never for an unknown one — see the route's own logic), letting a
vendor failure produce a different HTTP status than the generic case would have been a real
enumeration side-channel: an attacker probing many addresses could have inferred "any request
that errors differently means this account exists." Covered by a new regression test in
`auth-routes.test.ts`.

## 6. Timeouts, retries, idempotency

- **Timeout**: `fetchWithTimeout()`, 60s default, configurable — identical mechanism/helper
  every AI provider adapter already uses (BUILD 19).
- **Retry**: bounded (`maxAttempts`, default 3), linear backoff (`retryBackoffMs * attempt`,
  default 200ms base) — retries ONLY a classified-retryable failure (rate limit, timeout,
  5xx); never an auth failure or a validation/permanent rejection. Deliberately more
  permissive than BUILD 21's AI-generation decision (which chose NOT to auto-retry, because a
  duplicate image generation is a real, uncontrolled cost): a duplicate email send is a
  nuisance, not a $ cost, and is additionally protected against by real idempotency (next
  bullet) — so a bounded, backed-off retry here is the correct, safer default.
- **Idempotency**: `EmailMessage.idempotencyKey`, sent as Resend's own real, documented
  `Idempotency-Key` header. `handleRequestPasswordReset()` passes the password-reset token's
  own hash (`hashResetToken(rawToken)`, already computed before the send, already unique per
  request) — so this adapter's own internal retry loop, AND a hypothetical future
  client-level retry of the whole `POST /auth/password-reset/request` request, can never
  result in two delivered emails for the same logical reset request.

## 7. Observability

`handleRequestPasswordReset()` logs one structured, secret-free line per send attempt
(`context.logger`, the same `Logger` interface/redaction BUILD 18 established, the same
per-attempt pattern BUILD 21 introduced for AI generation): latency, outcome (`sent`) on
success; latency, `code`, `providerCode` on failure. Never logs: the API key, the raw reset
token, the email body, or the recipient address beyond what the route already legitimately
needs.

## 8. Health/readiness

`GET /ready`'s `providers.email.configured` reports whether a real vendor AND its credential
are both set — deliberately never called "verified": key presence is not proof of a working
integration (same policy BUILD 21 established for the four AI providers). A missing/
unconfigured email vendor never flips overall `/ready` `status` to `not_ready` — this
deployment can still serve every other feature without real email delivery; only the
password-reset flow's email step is affected (and even then, degrades to "recorded, never
delivered," never to a broken endpoint).

## 9. Live verification

`apps/api/src/live-email-smoke.test.ts` — gated on `RUN_LIVE_EMAIL_SMOKE_TEST=true` plus
`RESEND_API_KEY`/`EMAIL_FROM`/`EMAIL_TEST_RECIPIENT` (a real, controlled test recipient, never
a live user's address) all being set; missing any one skips the whole suite, reported as
skipped, never as a fake pass. **In this environment, none of these exist** (verified directly
against `process.env`) — the live suite skips, honestly, exactly as designed. No live email
delivery has been claimed successful anywhere in this build.

## 10. Security

- `RESEND_API_KEY` is listed in `SECRET_ENV_KEYS` (`env.ts`) — redacted by `Logger` wherever
  it might appear in a context object by key name.
- Never appears in: `/ready`'s response (only a boolean), any thrown `DomainError` message
  (verified by a dedicated test), the built `apps/web` bundle (verified by grep post-build —
  zero matches), or this documentation (only placeholders).
- `apps/web` never calls the vendor or reads any email config — `env.ts` remains
  server-side-only (unchanged rule, CLAUDE.md rule 6).
