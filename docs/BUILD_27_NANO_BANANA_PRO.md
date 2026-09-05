# BUILD 27 — AI Image Model: Nano Banana 2 + Nano Banana Pro + ChatGPT Image

Companion to `docs/BUILD_25_MULTI_MODEL_IMAGE_ENGINE.md` (the model registry this build extends) and
`docs/BUILD_26_PRODUCTION_UX_RENDER_WORKFLOW.md` (the render workflow this build's new model rides
through unchanged). This build adds **Nano Banana Pro** (`gemini-3-pro-image`) as the third real,
selectable AI Image Model, alongside the existing Nano Banana 2 (default) and ChatGPT Image. It does
not touch the render pipeline, remove any existing provider/model, or change any prior BUILD's UX.

## 1. Model matrix

| Model | Provider | Model id | Role | Default | Enabled |
|---|---|---|---|---|---|
| Nano Banana 2 | Google Gemini | `gemini-3.1-flash-image` | Default / workhorse | Yes | Yes |
| Nano Banana Pro | Google Gemini | `gemini-3-pro-image` | Premium / complex professional generation | No | Yes |
| ChatGPT Image | OpenAI | `gpt-image-1` | Alternative | No | Yes |
| Google Flow | Google | `google-flow` | — | No | No (`NOT_IMPLEMENTED`, unchanged since BUILD 12 — no official public API exists) |

Selector order (`ScenarioSlots.tsx`'s "AI Image Model" field, `packages/ai-core/src/image-model-registry.ts`'s
`getEnabledImageModels()`): **Nano Banana 2 → Nano Banana Pro → ChatGPT Image**. Only these three
options are ever shown — Google Flow and any hypothetical "Local AI" are never offered (the latter does
not exist anywhere in this codebase; there was nothing to remove).

> **BUILD 27 FIX** — an initial version of this build's selector also appended a non-model **"Auto"**
> choice (a selection strategy, not a real model). This was found to be a defect and removed entirely:
> from the UI dropdown (`ScenarioSlots.tsx`), the wire-level `renderCoreSchema`
> (`apps/api/src/schemas.ts`, generation/view/regenerate requests now reject it with
> `VALIDATION_ERROR`), the `RENDER_CORE_SELECTION` map (`apps/api/src/routes.ts`), and
> `RenderCoreSelection`/`ImageGenerationService.resolve()`'s "pick by capability + policy" fallback
> branch (`packages/model-adapters/src/service.ts`) — deleted, not just hidden. Every generation now
> names one of the three real models explicitly; there is no "let the server pick" path anymore.
> `SCENARIO_RENDER_CORES` (`packages/ai-core/src/scenario-vocabulary.ts`) deliberately still contains
> `'Auto'` as a vocabulary member — that constant is shared, unrelated, generic-placeholder fixture
> value in several Prompt Engine/Reasoning Engine domain tests untouched by this fix (out of scope,
> per this fix's own "KHÔNG thay đổi Prompt Engine" instruction); it is unreachable from any real user
> path now that the UI and the API schema both refuse it.

`gemini-3-pro-image` is a real, stable, current Google model id — validated against current official
documentation (accessed 2026-09-05): `https://ai.google.dev/gemini-api/docs/gemini-3`,
`https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-pro-image`. Not a
preview-suffixed id (`gemini-3-pro-image-preview`, seen on some third-party docs) — the stable id was
used per this build's own instruction.

## 2. Why one adapter, not two

Nano Banana 2 and Nano Banana Pro share the exact same Google Gemini Interactions API contract — same
endpoint (`https://generativelanguage.googleapis.com/v1beta/interactions`), same request/response shape;
only the `model` field and the model's own real capability ceiling differ (confirmed against current
docs). `packages/model-adapters/src/nano-banana-adapter.ts`'s `createNanoBananaAdapter()` already
accepted a `model` override; this build adds two more optional fields — `id` and `capabilities` — so a
second registered instance (`nano-banana-pro`) can report its own real adapter id and capability set
while the *default* instance (`nano-banana`, no overrides) behaves byte-for-byte as before. No second
adapter implementation, no duplicated request/error-handling logic.

Both instances read the same `NANO_BANANA_API_KEY` (docs/16) — one Google Gemini account, two of its
models — per this build's explicit instruction to keep env vars unchanged. `CHATGPT_IMAGE_API_KEY`
(ChatGPT Image, untouched adapter) and `GEMINI_API_KEY` (Vision Analysis/QC, untouched) are unrelated.

## 3. Wiring (`apps/api/src/app-context.ts`)

```ts
imageGenerationService: new ImageGenerationService({
  'nano-banana': createNanoBananaAdapter({ apiKey: config.nanoBananaApiKey }),
  'nano-banana-pro': createNanoBananaAdapter({
    apiKey: config.nanoBananaApiKey,
    model: 'gemini-3-pro-image',
    id: 'nano-banana-pro',
    capabilities: { maxResolution: '4K', supportedAspectRatios: ['1:1','3:2','2:3','4:3','16:9','9:16','21:9'] },
  }),
  'chatgpt-image': createChatGPTImageAdapter({ apiKey: config.chatgptImageApiKey }),
  'google-flow': new GoogleFlowAdapter(),
}),
```

`RenderCoreSelection` (`packages/model-adapters/src/service.ts`) gained `'nano-banana-pro'`;
`SCENARIO_RENDER_CORES` (`packages/ai-core/src/scenario-vocabulary.ts`) and `renderCoreSchema`
(`apps/api/src/schemas.ts`) gained `'Nano Banana Pro'`; `RENDER_CORE_SELECTION` (`apps/api/src/routes.ts`)
maps the two. `'auto'` still resolves to Nano Banana 2 (registered first in the adapter map, unchanged
resolution rule from BUILD 12/21).

## 4. Capability validation

Nano Banana Pro's registry entry declares real, current-docs-validated capabilities:

- **Resolution**: `1K`/`2K`/`4K` (no `0.5K` tier) — `mapResolutionToImageSize()` (unchanged) never emits
  `0.5K` for any model anyway, so the app's full `SCENARIO_RESOLUTIONS` vocabulary remains safe to offer.
- **Aspect ratio**: `1:1`, `3:2`, `2:3`, `4:3`, `16:9`, `9:16`, `21:9` — every non-`Custom` value this app
  already offers, all confirmed in current Gemini image-generation docs. Wider than Nano Banana 2's own,
  separately-validated, narrower set (`1:1`/`16:9`/`9:16`) — Nano Banana 2's set is deliberately left
  unchanged (CLAUDE.md rule 8: no reason to touch already-validated, working config outside this build's
  mandate).

`ScenarioSlots.tsx`'s existing BUILD 26 capability-aware `<option disabled>` logic (reads each model's
real registry `capabilities()`, never a second invented list) applies to Nano Banana Pro automatically —
no new UI logic needed. Selecting an unsupported aspect ratio/resolution for the current model still
disables that option and blocks "Apply Scenario" with a real, visible message; nothing unsupported is
ever sent to a provider.

## 5. Provider-configuration awareness ("Chưa cấu hình")

`GET /ready`'s `providers` object gained `nanoBananaPro` (boolean — credential present, same
`NANO_BANANA_API_KEY`, mirrors `nanoBanana`'s value; never the credential itself). Fetched once at app
bootstrap (`App.tsx`, alongside the existing `GET /auth/me` check) into `ProjectSessionState.providerConfiguration`
— `null` until that fetch resolves or if it fails, which never blocks or breaks the app. `ScenarioSlots.tsx`
appends `" — Not configured"` to a model's option label when its `configKey` reports `configured: false`;
the model stays fully selectable either way (never disabled for this reason — that would wrongly conflate
"not yet configured" with "not supported"). The actual, authoritative safety net — a real, honest
`PROVIDER_NOT_CONFIGURED` error, never a crash, never confused with a code failure — was already correct
and tested since BUILD 21/25/26; this label is purely an earlier, informational hint on top of it.

This fetch is deliberately isolated to app bootstrap (not a per-mount fetch inside `ScenarioSlots` itself)
specifically to avoid disturbing the many existing component tests (`ControlPanel.test.tsx`,
`ModuleWorkspace.test.tsx`, etc.) whose `fetch` mocks are keyed to call *order*, not URL — none of those
render `<App>`, so none of them trigger this fetch at all; only `App.test.tsx`'s already-generic
`mockResolvedValue` mock sees the extra call, harmlessly.

## 6. Error classification

Unchanged — `classifyProviderHttpStatus()` (`packages/shared/src/provider-error-category.ts`, BUILD 25)
is provider/model-agnostic and already applies to any Gemini-family adapter instance, Nano Banana Pro
included, via the shared `classifyGeminiError()` in `nano-banana-adapter.ts`. 401→`PROVIDER_AUTH_FAILED`,
403→`PROVIDER_FORBIDDEN`, 404→`PROVIDER_MODEL_NOT_FOUND`, 429→`PROVIDER_QUOTA_EXCEEDED`/`PROVIDER_RATE_LIMITED`,
5xx→`PROVIDER_UNAVAILABLE`, timeout→`PROVIDER_TIMEOUT` — no new retry behavior, no infinite retry (bounded
`maxAttempts`, unchanged).

## 7. Mock Mode

`createMockImageAdapter()` (BUILD 25, unchanged) already accepts a `modelId` override, so it needed no
changes to support all three models. A new test (`apps/api/src/mock-e2e.test.ts`) registers a
Mock-Provider instance per render core (`'nano-banana'`→`gemini-3.1-flash-image`,
`'nano-banana-pro'`→`gemini-3-pro-image`, `'chatgpt-image'`→`gpt-image-1`) and proves each reaches a real
201/succeeded output through the real HTTP pipeline, with `usageMetadata.mock: true` and
`note: 'MOCK — NO REAL API CALL'` always present — never indistinguishable from a real generation, never
faking a live provider success. Zero network calls (existing `mock-e2e.test.ts` external-host assertion
still passes unchanged).

## 8. Live Mode

No live Gemini/ChatGPT Image call was made or required by this build. `apps/api/src/live-provider-smoke.test.ts`
gained an opt-in-only Nano Banana Pro case (`renderCore: 'Nano Banana Pro'`), gated identically to the
existing Nano Banana case: skipped unless `RUN_LIVE_PROVIDER_SMOKE_TEST=true` **and** `NANO_BANANA_API_KEY`
is set. No auto-retry, no auto-billing, no credential ever logged or asserted into a response.

## 9. Not built this gate (deliberate scope decisions)

- **No new adapter class** — see §2.
- **Google Flow / "Local AI"** — not added, not touched. Google Flow stays `enabled: false`,
  `NOT_IMPLEMENTED`, exactly as BUILD 12 left it. "Local AI" does not exist anywhere in this repository.
- **Veo/video** — untouched; this build is image-generation only.
- **`SCENARIO_ASPECT_RATIOS`/`SCENARIO_RESOLUTIONS` themselves** — not replaced (same reasoning as BUILD 26
  §3: shared with video generation, out of this gate's scope).

## 10. Verification performed

Full regression suite, typecheck, lint, production build, and a re-grep of the built `apps/web` bundle for
every provider key/header name (zero matches) — see the BUILD 27 final report for exact counts. No live
provider call was made; **this build does not claim PRODUCTION READY** — see CLAUDE.md rule 7 and this
build's own STOP CONDITION.
