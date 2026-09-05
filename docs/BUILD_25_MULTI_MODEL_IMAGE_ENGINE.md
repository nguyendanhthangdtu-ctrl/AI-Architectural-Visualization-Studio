# BUILD 25 — Multi-Model Image Engine / Nano Banana 2

Companion to `docs/10_MODEL_ADAPTER_SPEC.md` (the original adapter contract, unchanged) and
`docs/BUILD_23_AI_PROVIDER_INTEGRATION.md`/`docs/BUILD_24_PRODUCTION_READINESS.md` (the real
provider path this build adds a registry and a Mock Provider on top of).

## 1. What Nano Banana 2 already was, and what this build actually added

`nano-banana-adapter.ts`'s default model was already `gemini-3.1-flash-image` — "Nano Banana
2," Google's own current name — since BUILD 12; this build did not introduce a new provider
or a new adapter. What was genuinely missing and is now real:

1. **A model registry** (`packages/ai-core/src/image-model-registry.ts`, new) — before this,
   a "model" was only ever a bare `renderCore` string (`SCENARIO_RENDER_CORES`) with no
   attached metadata (provider, real model id, resolution/aspect-ratio capabilities). This is
   presentation metadata only — no API key, no fetch, safe to import from `apps/web` (which
   already depends on `@avs/ai-core`, never on `@avs/model-adapters`).
2. **A real `image_size` request field** — the adapter only ever sent `aspect_ratio`; the
   `response_format.image_size` field Nano Banana 2's docs confirm was never populated. Now
   mapped from this app's own `SCENARIO_RESOLUTIONS` vocabulary via
   `mapResolutionToImageSize()` (`nano-banana-adapter.ts`) to the real, uppercase-`K` values:
   `0.5K`/`1K`/`2K`/`4K`.
3. **A real, reusable Mock Provider** (`packages/model-adapters/src/mock-image-adapter.ts`,
   new) — before this, only inline, duplicated `fakeSucceedingAdapter()`-style helpers existed
   per test file. `createMockImageAdapter()` implements the exact same
   `ImageGenerationAdapter` interface, returns a real, valid, decodable PNG (never a
   placeholder string), and makes zero network calls.
4. **A refined error taxonomy** — `403`/`404` now classify distinctly from `401`, and a `429`
   whose body mentions "quota" classifies as `PROVIDER_QUOTA_EXCEEDED` (never retried)
   instead of the generic `PROVIDER_RATE_LIMITED` (retried) — directly informed by a real
   Gemini 429 response observed in this project during BUILD 24's live-credential exercise
   ("You exceeded your current quota, please check your plan and billing details").
5. **The AI Image Model selector now defaults to Nano Banana 2** and only ever visibly offers
   real, enabled models (`ScenarioSlots.tsx`) — Google Flow (`NOT_IMPLEMENTED` since BUILD 12)
   is no longer offered as a choice, though its schema/adapter registration is unchanged.

## 2. Model registry

```ts
IMAGE_MODEL_REGISTRY = [
  { id: 'gemini-3.1-flash-image', renderCore: 'Nano Banana', provider: 'google-gemini',
    displayName: 'Nano Banana 2', enabled: true,
    capabilities: { defaultResolution: '1K', supportedResolutions: ['0.5K','1K','2K','4K'],
                    supportedAspectRatios: ['1:1','16:9','9:16'],
                    supportsReferenceImages: true, supportsImageEditing: true } },
  { id: 'gpt-image-1', renderCore: 'ChatGPT Image', provider: 'openai',
    displayName: 'ChatGPT Image', enabled: true, ... },
  { id: 'google-flow', renderCore: 'Google Flow', provider: 'google',
    displayName: 'Google Flow', enabled: false, ... }, // still NOT_IMPLEMENTED (BUILD 12)
]
```

`renderCore` is the join key back to the unchanged `SCENARIO_RENDER_CORES`/`renderCoreSchema`/
`RENDER_CORE_SELECTION` values — this registry describes the existing selection mechanism, it
does not replace it. `getEnabledImageModels()` filters to `enabled: true` only;
`findImageModelByRenderCore()` looks up one entry. `DEFAULT_IMAGE_MODEL_RENDER_CORE = 'Nano
Banana'` is the app's default image model selection.

## 3. Configuration

No new environment variables. `NANO_BANANA_API_KEY` (unchanged since BUILD 12) remains the
credential for Nano Banana 2 — server-side only (`apps/api`/`packages/model-adapters`), never
read by `apps/web`, never sent to the browser (verified: the built `apps/web` bundle was
grepped post-build for every provider key/header name — zero matches, same verification
method every prior build has used).

## 4. Resolution and aspect ratio mapping

| App resolution (`SCENARIO_RESOLUTIONS`) | Nano Banana 2 `image_size` |
|---|---|
| `Preview` (or empty/unrecognized) | `1K` (the registry's own default) |
| `2K` | `2K` |
| `4K` | `4K` |
| `6K` | `4K` (capped — Nano Banana 2 has no real 6K tier) |
| `8K/Ultra` | `4K` (capped) |

Aspect ratio is passed through unchanged (`request.aspectRatio` → `response_format.aspect_ratio`)
— the app never crops/reshapes the source architecture; this was already the adapter's
behavior and needed no change.

## 5. Error classification

`packages/shared/src/provider-error-category.ts`'s `classifyProviderHttpStatus()` (shared by
every adapter):

| Status | Category | Retryable |
|---|---|---|
| 401 | `PROVIDER_AUTH_FAILED` | no |
| 403 | `PROVIDER_FORBIDDEN` (new — split from 401) | no |
| 404 | `PROVIDER_MODEL_NOT_FOUND` (new) | no |
| 429, body mentions "quota" | `PROVIDER_QUOTA_EXCEEDED` (new) | **no** — retrying an exhausted quota immediately can never succeed |
| 429, otherwise | `PROVIDER_RATE_LIMITED` | yes (bounded, BUILD 23's existing 2-attempt policy) |
| 5xx | `PROVIDER_UNAVAILABLE` | yes |
| timeout | `PROVIDER_TIMEOUT` | no (ambiguous — provider may already be mid-generation) |
| invalid/non-image output | `GENERATION_OUTPUT_INVALID` (unchanged, BUILD 21/23) | no |

No existing test asserted 401-vs-403 or 404 behavior before this change (verified by search),
so this is a safe, non-breaking refinement — every adapter's own top-level `code` (e.g.
`NANO_BANANA_PROVIDER_ERROR`) is unchanged.

## 6. Mock Mode vs. Live Mode

- **Mock Mode**: `createMockImageAdapter()` — a real, shared, network-free implementation of
  `ImageGenerationAdapter`. Returns a real, valid, decodable 1×1 PNG (never a placeholder
  string) and labels its own `usageMetadata` with `mock: true` and `note: 'MOCK — NO REAL API
  CALL'` so it can never be mistaken for a real generation by anything reading persisted data
  later. Deliberately **not** wired into `app-context.ts`'s real production
  `ImageGenerationService` — it is a test-time tool, constructed directly by whichever test
  needs it, never a real user-selectable render core (see §8 for the reasoning).
- **Mock E2E** (`apps/api/src/mock-e2e.test.ts`, new): exercises the real production HTTP
  pipeline end-to-end — auth → project → real asset upload → analysis (mocked engine) →
  generation (Mock Provider, selected through the real `'Nano Banana'` render-core key) → QC
  (mocked engine) → real `AssetStore` → real signed URL → real byte-identical round-trip
  retrieval → real cross-user ownership rejection. Runs in **normal CI**, no flag required, no
  credential required — this is the free, always-on proof the pipeline itself is wired
  correctly.
- **Live Mode**: `live-provider-smoke.test.ts` (BUILD 19/21/23, unchanged by this build) —
  gated on `RUN_LIVE_PROVIDER_SMOKE_TEST=true` plus a real `NANO_BANANA_API_KEY`. This is the
  only thing that can ever change a provider's status from "configured" to "actually working"
  — see `docs/BUILD_24_PRODUCTION_READINESS.md` for the exact command and BUILD 24's own
  finding that a real key can authenticate successfully yet still be blocked by quota/billing
  (`PROVIDER_QUOTA_EXCEEDED`, §5) — that is an external dependency, never a code defect.

## 7. Security

- `NANO_BANANA_API_KEY` unchanged in `SECRET_ENV_KEYS` (`packages/shared/src/env.ts`) —
  redacted from logs by key name, as before.
- Never appears in: the built `apps/web` bundle (grepped, zero matches), any thrown
  `DomainError` message (existing adapter tests already assert this), `/ready` (booleans
  only), or this documentation.
- The Mock Provider makes this build's new `mock-e2e.test.ts` runnable with zero credential —
  verified by a dedicated test asserting no `fetch()` call in that suite ever targets a host
  other than the test's own local loopback server.

## 8. Scope decisions deliberately not implemented

- **No new "AI Provider Status" UI widget** (READY/MOCK MODE/LIVE/EXTERNAL DEPENDENCY
  BLOCKED/ERROR as a visible indicator) was built. The existing UI already has a real,
  working error-state path (`ErrorState.tsx` + `ModuleWorkspace.tsx`'s `renderStatus`) that
  correctly surfaces `PROVIDER_NOT_CONFIGURED`/`PROVIDER_QUOTA_EXCEEDED`/etc. as real,
  specific error messages when a generation actually fails — building a second, parallel
  status surface that duplicates this without a concrete UI request driving it would be scope
  beyond "sửa tối thiểu." `GET /ready`'s existing `providers.nanoBanana.configured` boolean
  (BUILD 21) already answers "is a credential present," which is the operator-facing half of
  this need.
- **The Mock Provider is not a selectable production `renderCore`.** Making "Mock" a real,
  user-facing choice would require extending `SCENARIO_RENDER_CORES`/`renderCoreSchema`/
  `RENDER_CORE_SELECTION` and wiring it into `app-context.ts`'s real service — a materially
  larger, riskier change than this build's mandate, and unnecessary: the Mock Provider's job
  (free, deterministic, credential-free pipeline testing) is fully served by test-time
  construction, exactly like every other test fixture in this codebase.
- **Nano Banana 2 Lite / Nano Banana Pro** were not added — no adapter or documented API for
  either exists in this repository or was made available to validate against; inventing one
  would violate CLAUDE.md rule 7 ("never fake a production integration").
