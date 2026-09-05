# BUILD 21 — Production AI Provider Integration

Companion to `docs/03_TECHNICAL_ARCHITECTURE.md` §35 (which records what changed and why,
per the established per-build convention) and `docs/10_MODEL_ADAPTER_SPEC.md` (the original
adapter contract). This document is the architecture/flow reference this build's spec asked
for; it does not duplicate either — read `docs/10` first for the adapter contract itself.

## 1. Current architecture (as of BUILD 21)

```
apps/web (React)                    apps/api (Node HTTP, no framework)
  ModuleWorkspace.tsx                  routes.ts
    handleRender()                      handleRunGeneration()/handleRunView()
      → runGeneration()                    → resolveOwnedProjectOrThrow()  (IDOR-safe)
        POST /projects/:id/generations      → resolveAssetOrThrow()        (ownership-checked bytes)
                                             → submitGeneration()
                                                 → JobQueue.enqueue()       (idempotency dedup)
                                                 → ImageGenerationService.resolve(renderCore)
                                                 → adapter.generate()       ← the ONLY network call
                                                 → validateImageOutput(decodeDataUri(uri))
                                                 → AssetStore.put()
                                             → GenerationRepository.create()
                                             → VersionRepository.create()   (version DAG, docs/03 ADR-006)
```

No UI ever calls a provider SDK directly (Phase 2 requirement) — `apps/web` only ever calls
`apps/api`'s own routes; every provider credential lives exclusively in `apps/api`'s process
environment (`packages/shared/src/env.ts`), never sent to the browser.

## 2. The provider abstraction

`ImageGenerationAdapter` (`packages/model-adapters/src/adapter.ts`) is this project's
`Application → Render/Generation Service → AI Provider Adapter → Real AI Provider API` boundary
the BUILD 21 spec asked for — already existed since BUILD 12, unchanged by this build:

```ts
interface ImageGenerationAdapter {
  readonly id: string;
  capabilities(): AdapterCapabilities;
  validate(request: GenerationRequest): ValidationResult;
  generate(request: GenerationRequest): Promise<GenerationResult>;
  edit?(request: EditRequest): Promise<GenerationResult>;
  normalizeError(providerError: unknown): NormalizedAdapterError;
}
```

Six concrete implementations exist today, each isolated in its own file, never sharing
mutable state: `nano-banana-adapter.ts` (Gemini native image gen), `chatgpt-image-adapter.ts`
(OpenAI Images API), `veo-adapter.ts` (Google Veo, video), plus three `@avs/ai-core` engines
with the analogous shape for non-generation AI work (`gemini-vision-engine.ts` — analysis,
`gemini-reference-engine.ts` — reference extraction, `gemini-qc-engine.ts` — QC).
`google-flow-adapter.ts`/`sora-adapter.ts` are real files that deliberately throw
`NOT_IMPLEMENTED` — no official public API exists for either (documented findings from
BUILD 12/16, re-verified unchanged in this build).

**Decision (Phase 3): no new unified interface was introduced.** These six adapters already
sit behind narrower, real, per-capability contracts that cleanly separate meaningfully
different request/response shapes (analyze vs. generate vs. edit vs. video). Collapsing them
into one wide `AIProvider` interface would be a rewrite with no behavioral benefit
(CLAUDE.md rule 8 — no rewrite without a documented reason). `Application → Render/Generation
Service → AI Provider Adapter → Real AI Provider API` already exists exactly as specified; it
just isn't named `AIProvider`.

## 3. Request/response flow (image generation, the mandatory production provider)

1. `apps/web` compiles the final prompt client-side (BUILD 11 `compilePromptOutput`, pure,
   no I/O) — architectural DNA, camera lock, material lock, style, lighting, composition are
   already baked into `promptText` by the time it reaches the API. `apps/api` never
   re-derives or mutates this text — it is a compiled artifact, exactly matching CLAUDE.md
   rule 1 ("Structured Intelligence is the source of truth; prompts are compiled artifacts").
2. `POST /projects/:id/generations` — validated (`runGenerationRequestSchema`), ownership
   is checked on the project AND every referenced asset (`resolveOwnedProjectOrThrow`,
   `resolveAssetOrThrow`), never a client-supplied id trusted blindly.
3. `submitGeneration()` (`routes.ts`) resolves the adapter (`RENDER_CORE_SELECTION`,
   `ImageGenerationService.resolve()`), builds the real `GenerationRequest` (real bytes for
   source/reference images, never a URL the adapter fetches itself — see
   `GenerationAssetRef`'s own doc comment, BUILD 13's correction of the original BUILD 02
   scaffolding), and calls `adapter.generate()` — the one real external network call in this
   entire path.
4. The adapter's real HTTP call goes through `fetchWithTimeout()` (`packages/shared`,
   BUILD 19) — a real, bounded `AbortController` timeout (60s default; Veo's video download
   specifically uses 180s), never an unbounded hang.
5. The provider's real response is decoded (`decodeDataUri`) and, for image outputs
   specifically, validated as a genuinely decodable image (`validateImageOutput`, **new in
   BUILD 21** — see §5) before ever reaching `AssetStore.put()`.
6. The persisted output asset, the `GenerationRecord`, and a new `GenerationVersion` are all
   real — same version-DAG pattern every generation-producing route already uses (docs/03
   ADR-006).
7. The response returns a real, time-limited signed URL for the output
   (`buildAssetUrl`/`AssetUrlSigner`, BUILD 18) — `apps/web` never receives a raw filesystem
   path or an unsigned, permanently-public URL.

## 4. Failure flow

Every adapter's real upstream failure is caught, classified, and re-thrown as a
`DomainError`/`NormalizedAdapterError` — never a raw provider exception, stack trace, or
response body reaching the client. `apps/api/src/error-handling.ts`'s `HTTP_STATUS_BY_CODE`
maps each provider's own code (`NANO_BANANA_PROVIDER_ERROR`, `VEO_PROVIDER_ERROR`, etc.,
unchanged by this build) to a real HTTP status (502 — "we are a gateway to an upstream that
failed," not the caller's fault).

**New in BUILD 21**: every classify function additionally sets a standardized
`providerCode` category (`packages/shared/src/provider-error-category.ts`) —
`PROVIDER_AUTH_FAILED` / `PROVIDER_RATE_LIMITED` / `PROVIDER_TIMEOUT` /
`PROVIDER_UNAVAILABLE` / `PROVIDER_INVALID_REQUEST` / `PROVIDER_BAD_RESPONSE` — derived from
the real upstream HTTP status. This is additive: the existing top-level `code` per adapter is
completely unchanged, so no existing error-handling test or client-side branch broke. The
category lets logs/dashboards group failures by *kind* across all six adapters without
conflating "Nano Banana is down" with "ChatGPT Image is down."

`PROVIDER_NOT_CONFIGURED` (503) is thrown synchronously, before any network call, whenever a
provider's API key is absent — verified live in BUILD 20's production-process smoke run (a
real `GET`/`POST` against a real running server, zero fabricated credential).

## 5. Image input/output pipeline (Phase 4)

**Input** (`apps/api/src/upload-validation.ts`, unchanged by this build): content-type
allowlist (`image/png`, `image/jpeg` only), a 20MB size cap, and `readImageDimensions()` — a
real, dependency-free PNG-IHDR/JPEG-SOF-marker parser that both confirms the upload is a
genuinely decodable image and enforces a 16000px-per-side cap (decompression-bomb guard).

**Output — a real, previously-unaddressed gap this build closed.** Before BUILD 21,
`decodeDataUri()` only checked the provider's response had the *shape* of a `data:` URI; it
never confirmed the decoded bytes were an actual, decodable image. A provider returning
corrupt, truncated, or non-image bytes inside a technically-well-formed `data:image/png;...`
wrapper would have been persisted as a "generated" asset with zero further validation.
`validateImageOutput()` (`routes.ts`) now reuses the exact same `readImageDimensions()` upload
validation already trusted for input, applied to the two image-output call sites (generation,
edit) — never to the video-download call site, since `video/mp4` is a real, expected,
non-image content type there. A provider returning something that fails this check now
produces a typed `GENERATION_OUTPUT_INVALID` (502), never a silently-persisted bogus asset.

Fixing this surfaced that five existing test files (`generation-route`, `view-route`,
`edit-route`, `video-route`, `generation-qc-route`) used a placeholder base64 string
(`"fake-generated-image"`, plain text) as their fake adapter's output — which the new
validation correctly rejects. All five were updated to use a real, minimal, valid PNG byte
string instead (the same `ONE_PIXEL_PNG` fixture several of these files already used for
uploads) — no test assertion was weakened; the fixtures became more honest.

## 6. Cost/duplicate-generation safety (Phase 8)

`JobQueue` (`apps/api/src/job-queue.ts`) already had per-idempotency-key dedup logic since
BUILD 13, but it was never actually wired to prevent a duplicate *provider* call — the
`idempotencyKey` passed in was always a fresh `randomUUID()` generated inside
`submitGeneration()` on every single call, so no two calls could ever collide, and even a
returned pre-existing `JobRecord` was ignored (the code called `adapter.generate()`
unconditionally regardless). A client-side network retry of an already-succeeded generation
would have silently re-billed the provider and could have persisted a second, different image.

**Fixed in BUILD 21**, minimally: `POST /projects/:id/generations` and `POST
/projects/:id/views` now accept an optional client-supplied `Idempotency-Key` request header.
When present and it matches a job that already `succeeded`, the cached
`{ generationResult, outputAssets }` (now stored on `JobRecord.result`) is returned directly
— the provider is never called a second time. When it matches a job still `running` (a
genuine concurrent duplicate), the second request is rejected with `409
GENERATION_IN_PROGRESS` rather than starting a second concurrent provider call. A `'failed'`
prior attempt is deliberately NOT short-circuited — retrying a generation that never actually
succeeded is the caller's legitimate recovery path, not a duplicate-cost risk. Absent the
header (every existing caller, including today's `apps/web`), behavior is byte-for-byte
identical to BUILD 20 — a fresh, always-unique key every call.

**Decision: not wired into `apps/web` yet.** `apiFetch()` has no automatic retry-on-
network-failure today, and the UI's own "Retry" button is a legitimately new user-initiated
attempt (should get a fresh key, not reuse one). Wiring a header that would always be a fresh
UUID from the only real caller today would be inert theater, not real protection. The backend
mechanism is real, tested, and ready for any client — a future retry-with-backoff wrapper, a
mobile client, or direct API integration — which is the correct scope boundary for this change
(CLAUDE.md rule 12, small reviewable changes).

## 7. Configuration & secrets (Phase 5)

Env var names are unchanged from BUILD 19/20 (`NANO_BANANA_API_KEY`, `GOOGLE_FLOW_API_KEY`,
`CHATGPT_IMAGE_API_KEY`, `VEO_API_KEY`, `SORA_API_KEY`, `GEMINI_API_KEY`, plus the
storage/auth/network vars) — per this build's own instruction to follow the project's
existing naming convention rather than introduce a generic `AI_PROVIDER`/`AI_API_KEY` pair.
No new env vars were added. Every key is read only in `apps/api` (`packages/shared/src/env.ts`
is explicitly documented as never importable from `apps/web`); `apps/web`'s bundle was
grepped post-build and contains zero occurrences of any provider key name (verified, not
assumed — see the BUILD 21 final report).

## 8. Security boundaries (unchanged, re-verified)

Every BUILD 18/19/20 guarantee — authentication, session revocation, project/asset
ownership (IDOR-safe), signed asset URLs, CORS, security headers, per-user rate limiting,
generic auth errors, secret redaction in logs — was re-run via the full existing test suite
(527/527 passing, 1 skipped by design) with zero regressions. This build's changes were
additive (a new header, a new validation step, a new log line, a new readiness field); no
existing authorization/ownership check was touched.

## 9. Live verification plan (Phase 7)

`apps/api/src/live-provider-smoke.test.ts` (BUILD 19, unchanged by this build) is the
mandatory live smoke test: gated on `RUN_LIVE_PROVIDER_SMOKE_TEST=true` plus each provider's
own real API key being present; makes zero network calls and needs zero credentials in normal
CI. It exercises the full real HTTP pipeline (register → project → upload → generate → real
provider → real asset persistence → real signed retrieval → cleanup) against whichever real
provider key is actually configured. See `docs/BUILD_21_OPERATOR_RUNBOOK.md` for the exact
command. **In this environment, zero provider credentials exist** (verified directly against
`process.env`, not assumed) — the live suite skips, honestly, exactly as designed. No live
generation has been claimed successful anywhere in this build.

## 10. Rollback strategy

Every BUILD 21 change is additive and independently revertable:

- The `Idempotency-Key` header is optional; removing the check in `submitGeneration()`
  restores BUILD 20's exact behavior (a fresh key every call).
- `validateImageOutput()` can be removed from the two image call sites without touching
  `decodeDataUri()` itself (the generic shape/non-empty check), reverting to BUILD 20's
  weaker-but-functional output handling.
- `providerCode` is an additive field on an already-optional `ErrorEnvelope` property —
  removing the `classifyProviderHttpStatus()` calls reverts every adapter's error object to
  its exact BUILD 20 shape.
- `providers` on `GET /ready` and `AppContext.logger`/`.providerConfiguration` are additive
  fields; no existing consumer of `/ready` or `AppContext` was changed to require them.

A `git revert` of this build's commit cleanly restores BUILD 20 behavior with no data
migration, no schema change, and no env var removal required.
