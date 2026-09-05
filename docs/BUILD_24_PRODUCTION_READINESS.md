# BUILD 24 — Live AI Provider Activation & Production Readiness

Release-validation record for this gate. Companion to `docs/BUILD_23_AI_PROVIDER_INTEGRATION.md`
(the adapters this gate activates), `docs/BUILD_21_PRODUCTION_INTEGRATION.md` (the pipeline
this gate validates end-to-end), and `docs/BUILD_21_OPERATOR_RUNBOOK.md` (exact commands).

## 1. Provider(s) this gate targets

Either real image-generation adapter already implemented (BUILD 12/21/23) is sufficient to
satisfy release validation — the release specification does not require both:

| Provider | Credential variable | Model variable | Status this gate |
|---|---|---|---|
| Nano Banana (Gemini native image gen) | `NANO_BANANA_API_KEY` | none (fixed default, `nano-banana-adapter.ts`) | Not configured in this environment |
| ChatGPT Image (OpenAI) | `CHATGPT_IMAGE_API_KEY` | none (fixed default, `chatgpt-image-adapter.ts`) | Not configured in this environment |

Whichever one an operator configures first is the one `live-provider-smoke.test.ts` actually
exercises — its per-provider `describe.skipIf` blocks run independently, so configuring only
one is a complete, valid release validation for that provider; the other remains available but
not release-blocking (exactly this gate's own instruction for the single-required-provider
case).

## 2. Secure credential activation (what this gate verified, without ever seeing a real key)

`process.env` was inspected directly for presence/absence only — never for value — of
`GEMINI_API_KEY`, `NANO_BANANA_API_KEY`, `CHATGPT_IMAGE_API_KEY`, `VEO_API_KEY`,
`RESEND_API_KEY`, `EMAIL_PROVIDER`, `RUN_LIVE_PROVIDER_SMOKE_TEST`. All were `MISSING`. No
`.env` file exists in this environment. Diagnostic output throughout this gate was limited to
`configured: true/false` (see `GET /ready`, §5) — never a key value, prefix, length, or hash.

**To activate for real** (operator action, not performed here):
```bash
export NANO_BANANA_API_KEY=<real key>      # or CHATGPT_IMAGE_API_KEY
```
Then confirm activation the same safe way this gate did — via `GET /ready`'s
`providers.nanoBanana.configured` (or `.chatgptImage`), never by echoing the variable.

## 3. Deterministic pre-live validation (this gate's own results)

All run against BUILD 23's baseline (`37b2a61`), before any live-credential decision:

| Check | Result |
|---|---|
| `npx tsc -b --force` (typecheck, whole workspace) | PASS |
| `npx vitest run` (unit + integration + security + regression) | PASS — 569/569, 3 skipped by design |
| `npm run lint` | PASS |
| `npm run build` (production build) | PASS |
| `git diff --check` | PASS (clean, no changes yet at this point) |

No release-blocking defect was found. BUILD 21/22/23 behavior is confirmed intact — the same
569/3 result as BUILD 23's own final report, unchanged.

## 4. Live health/readiness verification (real running process, not just unit tests)

A real `node apps/api/dist/server.js` process was started (file-backed `node:sqlite` DB, real
local-disk asset store, a transient self-generated `REGISTRATION_SECRET` used only for this
run and deleted afterward) with **no** AI/email credential set, and driven via real HTTP:

```json
GET /health → 200 {"status":"ok"}
GET /ready  → 200 {
  "status": "ready",
  "checks": {"database": {"status": "ok"}, "assetStore": {"status": "ok"}},
  "providers": {
    "gemini": {"configured": false}, "nanoBanana": {"configured": false},
    "chatgptImage": {"configured": false}, "veo": {"configured": false},
    "email": {"configured": false}
  }
}
```

`/health` never required a real generation call (liveness only). `/ready` correctly reports
every provider unconfigured without flipping overall `status` to `not_ready` — a deployment
with no AI/email key yet can still serve auth/asset/DB traffic, exactly BUILD 21/22's design.
Neither response contained any secret, stack trace, or file path (confirmed by direct
inspection of the raw response body).

A real generation request was then submitted against this live process (`POST
/projects/:id/generations`, real registered account, real uploaded asset, `renderCore: "Nano
Banana"`) to prove the "no credential configured" failure path is safe in a genuinely running
process, not only in a unit test:

```json
HTTP 503
{"code":"PROVIDER_NOT_CONFIGURED","message":"NANO_BANANA_API_KEY is not configured — set it in .env to enable the Nano Banana adapter (docs/16).","retryable":false}
```

Clean, typed, no crash, no leaked internals. The live-test server's own JSON logs were scanned
afterward for the transient registration secret used in this run — it did not appear. The
process was killed and every artifact (SQLite file, asset directory, secret, logs) deleted;
this repository's own working tree was unaffected throughout.

## 5. Live AI generation smoke test — result

```bash
npx vitest run apps/api/src/live-provider-smoke.test.ts apps/api/src/live-email-smoke.test.ts
# → 2 files, 5 tests, all skipped
```

**SKIPPED — EXTERNAL DEPENDENCY.** Neither `NANO_BANANA_API_KEY`/`CHATGPT_IMAGE_API_KEY` (image)
nor `RESEND_API_KEY`/`EMAIL_FROM`/`EMAIL_TEST_RECIPIENT` (email) exist in this environment. No
live provider call was made, no image was generated, and no result is claimed. This is
reported as skipped, never as a fabricated pass, per this gate's own non-negotiable rule.

## 6. Exact gated live-test procedure (for an operator who has a real key)

```bash
# Image generation (choose one — either satisfies release validation):
RUN_LIVE_PROVIDER_SMOKE_TEST=true NANO_BANANA_API_KEY=<real key> \
  npx vitest run apps/api/src/live-provider-smoke.test.ts

RUN_LIVE_PROVIDER_SMOKE_TEST=true CHATGPT_IMAGE_API_KEY=<real key> \
  npx vitest run apps/api/src/live-provider-smoke.test.ts
```

This exercises the complete production path this gate's spec requires, through the real
application — never an ad-hoc script bypassing it:
`POST /auth/register` → `POST /projects` → `POST /projects/:id/assets` (real 1x1 PNG fixture,
already in the test file) → `POST /projects/:id/analysis` or `POST /projects/:id/generations`
(real `promptText`, already-compiled by the Prompt Engine per BUILD 11 — the test never
bypasses it) → the real adapter's one real HTTP call to the real provider → `decodeDataUri`/
`validateImageOutput` (real decodability + dimension check, BUILD 21/23) → `AssetStore.put()`
→ a real signed URL → a real `GET` of that signed URL, asserted byte-for-byte against nothing
fabricated (the provider's own real bytes) → cleanup via the real `DELETE` route.

**Cost note**: this is exactly one controlled, small (`aspectRatio: '1:1'`, minimal prompt),
real generation request per provider tested — real provider quota/cost applies. The test does
not loop, retry beyond the adapter's own bounded (2-attempt, BUILD 23) retry policy, or
regenerate after success.

## 7. Test fixture used

`live-provider-smoke.test.ts`'s own `ONE_PIXEL_PNG` (a real, valid, minimal 1×1 PNG) is the
source image; the test's own prompt (`'A single red sphere on a white background'`) is
deliberately simple and does not ask the provider to invent architecture not present in the
tiny fixture — matching this gate's "must not require the provider to invent architecture
that does not exist in the source" instruction. No SketchUp/3ds Max-style fixture currently
exists in the repository to exercise a real camera-preservation assertion end-to-end; the
Prompt Engine's camera/architecture-preservation logic itself is unchanged and was validated
by its own existing unit tests (BUILD 08/09), not re-validated pixel-by-pixel here — this gate
did not have a real provider response to judge visual preservation against.

## 8. Camera / architecture preservation — what was and wasn't verified

Per this gate's own instruction ("do not attempt pixel-perfect semantic judgment
automatically unless the repository already has such a QC mechanism"): no such automated
visual-preservation QC exists yet, so none was fabricated here. What WAS verified: the
application-side request path sends the Prompt Engine's own compiled `promptText` unchanged
(`submitGeneration()` never rewrites it — confirmed by reading `routes.ts`, unchanged since
BUILD 21), and the adapter never adds, removes, or reorders prompt content before sending it
to the provider (confirmed by reading `nano-banana-adapter.ts`/`chatgpt-image-adapter.ts` —
`promptText` is passed through as the first `input` element, verbatim).

## 9. Output validation, Asset Store, QC — mechanism status

Real and already tested (BUILD 21/23): `validateImageOutput()` rejects a non-decodable/
zero-byte/oversized response before persistence; `AssetStore.put()` failures now correctly
mark the job `'failed'` rather than zombie it (BUILD 23's fix); QC remains its own explicit,
user-triggered route (`POST .../qc`, BUILD 17) — not run automatically as part of generation,
unchanged, intentional. None of this was exercised against a REAL provider response in this
gate, since none was called — the mechanism's correctness is proven by its own unit/
integration tests, not by a live result that didn't happen.

## 10. Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `503 PROVIDER_NOT_CONFIGURED` | No credential set for the selected `renderCore` | Set the matching `*_API_KEY`, restart |
| `502` with `providerCode: PROVIDER_AUTH_FAILED` | Real key rejected by the provider | Rotate the key (see runbook §14); never retried automatically |
| `502` with `providerCode: PROVIDER_RATE_LIMITED` | Real quota exceeded | Adapter already retried once (bounded, BUILD 23); wait and retry manually |
| `409 GENERATION_IN_PROGRESS` | A concurrent request reused the same `Idempotency-Key` | Expected — not a bug; use a fresh key for a genuinely new attempt |
| Live smoke test skips silently | No credential / `RUN_LIVE_PROVIDER_SMOKE_TEST` unset | Expected by design — see §6 |

## 11. Security precautions applied throughout this gate

- Every credential check used presence-only inspection (`Boolean(process.env.X)`), never
  value inspection, printing, or hashing.
- The transient `REGISTRATION_SECRET` generated for the live-server check (§4) was never
  logged, was scanned-for-absence in the server's own log output afterward, and was deleted
  with all other run artifacts before this gate's work concluded.
- `git diff --check`, an untracked-file scan, and a manual secret-shaped-string scan were all
  run before commit (see the final report's Security Verification line).
- The built `apps/web` bundle was grepped for every provider/vendor credential name — zero
  matches (unchanged verification method from BUILD 21-23).

## 12. Final release criteria for this gate

Per this gate's own Section 19/20 rules: PRODUCTION READY requires a **successful real live
AI generation**, among other criteria. None was attempted (no credential exists), so this gate
cannot and does not claim PRODUCTION READY. Every other release gate this document's spec
enumerates (baseline preservation, security, tests, build, health/readiness) passed — see the
BUILD 24 — FINAL REPORT for the complete, itemized result.
