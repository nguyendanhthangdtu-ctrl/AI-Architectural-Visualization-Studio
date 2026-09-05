# BUILD 23 — Real AI Provider Integration & Live Image Generation

Companion to `docs/03_TECHNICAL_ARCHITECTURE.md` §37 and `docs/BUILD_21_PRODUCTION_INTEGRATION.md`
(BUILD 21 already implemented the core real-AI-provider path this build hardens — read that
document first for the full architecture/flow; this one covers only what changed).

## 1. What already existed (BUILD 21), preserved unchanged

The full pipeline this build's spec describes — `USER INPUT → PROMPT ENGINE → AI PROVIDER
ADAPTER → REAL IMAGE GENERATION API → RAW PROVIDER RESPONSE → OUTPUT VALIDATION → QC → ASSET
STORE → UI` — was already real as of BUILD 21:

- `ImageGenerationAdapter` (`packages/model-adapters/src/adapter.ts`) is the provider
  abstraction; `createNanoBananaAdapter()`/`createChatGPTImageAdapter()` are the two real
  image-generation implementations (Gemini's Interactions API, OpenAI's Images API).
- The prompt engine remains authoritative — `promptText` arrives at `apps/api` already
  compiled (BUILD 11's `compilePromptOutput`, client-side, pure); no adapter or route ever
  rewrites or discards it.
- `validateImageOutput()`/`decodeDataUri()` (`routes.ts`) already reject a provider response
  that isn't a real, decodable image before it ever reaches `AssetStore.put()`.
- `GET /ready` already reports `providers.{gemini,nanoBanana,chatgptImage,veo}.configured`.
- `live-provider-smoke.test.ts` already exists, gated on `RUN_LIVE_PROVIDER_SMOKE_TEST=true`
  plus each provider's own real key.

This build did not rebuild any of that. It closed three real, verified gaps found while
auditing it against this build's own requirements.

## 2. Gap 1 — no bounded retry existed for transient AI-provider failures

BUILD 21 deliberately added zero auto-retry for image generation, reasoning that a duplicate
generation is a real, uncontrolled cost. This build's spec explicitly asks for bounded retry
on transient/rate-limit failures specifically — a narrower, safer claim than "retry
everything," so it refines rather than reverses BUILD 21's decision:

- **What retries** (`nano-banana-adapter.ts`, `chatgpt-image-adapter.ts`, both `generate()`
  and `edit()`): only `PROVIDER_RATE_LIMITED` (429) and `PROVIDER_UNAVAILABLE` (5xx) — cases
  where the provider's own infrastructure explicitly rejected the request before doing any
  real generation work. Default 2 attempts (deliberately smaller than the email adapter's
  default 3 — each retry here is a real, billable generation attempt), linear backoff.
- **What never retries**: `PROVIDER_AUTH_FAILED`, `PROVIDER_INVALID_REQUEST` (both permanent
  — retrying an unchanged rejected request is never correct), and — the important one —
  **`PROVIDER_TIMEOUT`**. Both adapters are synchronous, single-call APIs (the image comes
  back in the same HTTP response, not via polling); if our own client gives up waiting, the
  provider may already be mid-generation, or may have already produced billable output we
  never received. Retrying here could create a second real, paid generation for one logical
  request — so this is the one case BUILD 21's original caution still fully applies to, and
  it remains completely un-retried.
- Implemented via a new shared `withBoundedRetry()` (`packages/shared/src/bounded-retry.ts`),
  extracted from BUILD 22's Resend adapter (which had its own inline copy of this exact loop)
  so both email and image-generation adapters share one real, tested mechanism rather than
  duplicating it (CLAUDE.md rule 9). `resend-email-sender.ts` was refactored to use it too —
  behavior unchanged, verified by its full existing test suite still passing.
- A related, previously-inconsistent gap fixed alongside this: both adapters' timeout branches
  now set `providerCode: 'PROVIDER_TIMEOUT'` (they previously threw a `DomainError` with no
  `providerCode` at all — an oversight from BUILD 21's original taxonomy rollout).
- Both adapters also gained a real, configurable `timeoutMs` (previously only
  `gemini-vision-engine.ts` had this BUILD 19 knob; the two image-generation adapters always
  used the shared, non-configurable default). Defaults to `DEFAULT_PROVIDER_TIMEOUT_MS`
  (60s) — no behavior change unless a caller opts in.

## 3. Gap 2 — a real "zombie job" bug in the asset-persistence step

`submitGeneration()` (`routes.ts`) previously left the `JobRecord` stuck at `'running'`
forever if anything failed AFTER a successful provider call: an invalid provider output
(`GENERATION_OUTPUT_INVALID`) or a real `AssetStore.put()` failure (disk full, permission
error) both threw from inside an unguarded block, so the job's status was never updated past
`'running'`.

This was not merely a cosmetic status bug: BUILD 21's own idempotency-key dedup logic treats
a `'running'` job as "a concurrent request is still mid-flight" and rejects any repeat of that
exact key with `409 GENERATION_IN_PROGRESS` — meaning a real asset-store hiccup would have
**permanently** blocked that idempotency key from ever succeeding again, even after the
underlying storage problem was fixed.

Fixed by wrapping the output-validation-and-persistence step in its own try/catch: any
failure there now marks the job `'failed'` (same as a provider-call failure), logs it safely,
and re-throws a real, classified error — a new `ASSET_STORE_ERROR` (502→500, this app's own
storage failing, not an upstream gateway) for a genuine `AssetStore.put()` failure specifically,
distinct from `GENERATION_OUTPUT_INVALID` for a bad provider response. Covered by two new
regression tests: one proving the job reaches `'failed'` (not stuck `'running'`) on an
asset-store failure, and one proving the *exact same* idempotency key can be retried
successfully afterward once the underlying problem is resolved.

## 4. Gap 3 — nothing else was actually missing

Everything else this build's spec enumerates was inspected and confirmed already real and
already tested as of BUILD 21/22, not rebuilt:

- Reference-image flow, upload validation, output validation, asset ownership/signed
  retrieval, error taxonomy (`providerCode` categories map 1:1 onto this build's requested
  names — `AUTHENTICATION_ERROR`≈`PROVIDER_AUTH_FAILED`, `PROVIDER_BAD_REQUEST`≈
  `PROVIDER_INVALID_REQUEST`, `PROVIDER_TRANSIENT_ERROR`≈`PROVIDER_UNAVAILABLE`,
  `INVALID_PROVIDER_OUTPUT`≈`GENERATION_OUTPUT_INVALID`, `MISSING_CONFIGURATION`≈
  `PROVIDER_NOT_CONFIGURED` — kept the existing names rather than renaming a working,
  tested taxonomy, per CLAUDE.md rule 8), observability (`submitGeneration()`'s structured
  log line), `/ready`'s provider status reporting, and the UI's existing idle/loading/error
  states (`ModuleWorkspace.tsx`, `ErrorState.tsx`) — all unchanged, all re-verified via the
  full regression suite rather than re-implemented.
- QC remains its own explicit, user-triggered route (`POST
  /projects/:id/generations/:id/qc`, BUILD 17) — not inlined into generation automatically;
  this is existing, intentional architecture (docs/15), not a gap.

## 5. Environment configuration

No new environment variables were introduced. `NANO_BANANA_API_KEY`/`CHATGPT_IMAGE_API_KEY`/
`GEMINI_API_KEY`/`VEO_API_KEY` remain exactly as named since BUILD 12 — this build's spec
explicitly asks to preserve an existing credential variable rather than introduce a generic
`AI_PROVIDER`/`AI_MODEL` selector, and per-provider naming is what the repository already
uses. The two adapters' new `timeoutMs`/`maxAttempts`/`retryBackoffMs` are constructor
config, not environment variables — no operator-facing knob was added for them (sensible
defaults are used everywhere); this can be revisited if a real deployment ever needs to tune
them, without a schema change (they're already parameters, just not yet threaded from
`env.ts`).

## 6. Security

- No secret was hardcoded, logged, or added to any response — the built `apps/web` bundle was
  grepped post-build for every AI provider key name (zero matches).
- The two new regression tests exercise real failure paths (asset-store failure, invalid
  output) without ever touching a real credential.
- The full BUILD 01–22 security regression suite (auth, IDOR, signed URLs, CORS, headers,
  rate limiting, secret redaction) was re-run — zero regressions.

## 7. Live AI generation smoke test

`live-provider-smoke.test.ts` (BUILD 19/21, unchanged by this build) already satisfies this
build's live-smoke-test requirements in full: gated on `RUN_LIVE_PROVIDER_SMOKE_TEST=true`
plus each provider's own key; sends one real, small, cost-bounded generation request; validates
the real response; persists through the real `AssetStore`; verifies real signed retrieval;
cleans up every asset it creates; never mocks the HTTP layer. **In this environment, zero AI
provider credentials exist** (verified directly against `process.env`) — the suite correctly
skips every provider-gated sub-test, reported as skipped, never as a fake pass. No live
generation is claimed anywhere in this build.
