# BUILD 26 — Production UX & Render Workflow Hardening

Companion to `docs/BUILD_25_MULTI_MODEL_IMAGE_ENGINE.md` (the model registry this build hardens)
and `docs/02_UX_SPECIFICATION.md` (the existing UX rules this build audited against, not
redesigned). This build is an audit-and-harden gate: the render workflow
(Upload → Analysis → Detect Prompt → Prompt Editor → Camera/Composition → Visual Controls →
Model → Render → Result → QC → Asset Store → Signed URL → Download) already existed in real,
working form since BUILD 06–25. This document records the real gaps found and fixed, and the
scope deliberately not built out further.

## 1. What was already correct, re-verified, not rebuilt

- **Workflow order and canvas priority** (`Workspace.tsx`, `ControlPanel.tsx`) — Source Image
  → Reference → Detect Prompt (`PromptFromImage`) → Prompt Editor → Locks → Scenario, exactly
  matching this build's requested step order. The canvas remains central; the Inspector
  (former "AI Analysis Panel") stays a collapsible, closed-by-default `Panel` — it was NOT
  restored to a permanent panel, per this build's own explicit instruction.
- **Upload** (`UploadDropzone.tsx`) — drag & drop, file picker, real MIME/size/dimension
  validation (`upload-validation.ts`, BUILD 06/18), empty/malformed rejection, real states.
- **Camera lock / architecture preservation** — `LockControlGroup`, the compiled prompt's own
  `preserveArchitecture`/`preserveCamera` flags (BUILD 08/09/11), and `Camera Lock: ON` framing
  are unchanged; the adapter never rewrites `promptText` (verified by reading
  `nano-banana-adapter.ts`/`chatgpt-image-adapter.ts` — the prompt is passed through verbatim).
- **QC, Asset Store, signed URL** — unchanged since BUILD 17/18/21/23; QC remains its own
  explicit, user-triggered route (not an automatic gate blocking "READY" — see §4).
- **Render button already validated + guarded against duplicates** — `canRender` requires a
  source image, an applied scenario (which itself requires model/resolution/aspect ratio to be
  set), and non-empty prompt text before enabling; the button disables itself during
  `renderStatus === 'loading'`, preventing a duplicate in-flight request.

## 2. Real gaps found and fixed

### 2.1 A real unit-mismatch bug in the BUILD 25 model registry

`IMAGE_MODEL_REGISTRY`'s Nano Banana 2 entry described `supportedResolutions` in the
*provider's own* wire units (`'0.5K'/'1K'/'2K'/'4K'`), while every other entry (ChatGPT Image,
Google Flow) described theirs in the *app's* `SCENARIO_RESOLUTIONS` vocabulary
(`Preview/2K/4K/6K/8K-Ultra`). Since `mapResolutionToImageSize()` (`nano-banana-adapter.ts`)
already accepts and correctly translates any app-level resolution (capping at 4K), Nano
Banana 2 actually supports the full app vocabulary — the registry now says so, fixed to
`supportedResolutions: [...SCENARIO_RESOLUTIONS]`, `defaultResolution: 'Preview'` (the
app-level value that maps to its real `1K` baseline).

### 2.2 A real, previously-unenforced capability gap — aspect ratio/resolution could silently mismatch the selected model

Every adapter's own `capabilities()` (accurate since BUILD 12) declares a real, narrower
`supportedAspectRatios` than the full `SCENARIO_ASPECT_RATIOS` list the UI offered — e.g. Nano
Banana 2 only supports `1:1`/`16:9`/`9:16`. Nothing previously stopped a user from selecting
`4:3` with Nano Banana 2 selected and sending that exact combination to the real provider.
Fixed in `ScenarioSlots.tsx`:

- Aspect Ratio and Generation Resolution `<option>` elements are now `disabled` when the
  currently-selected AI Image Model's real registry capabilities don't include that value —
  reusing the existing, accurate per-adapter capability data, never a second invented list.
- If a user picks a value, then switches to a model that doesn't support it, "Apply Scenario"
  is now blocked with a real, visible message (`role="alert"`) naming exactly which field and
  value is incompatible — never a silent bad request to the provider.
- `'Auto'` (a selection strategy, not a model) never disables anything client-side — the
  server resolves it to whichever adapter is actually registered.

### 2.3 Render button label

Changed from `'Render'` to the exact required `'RENDER — PHOTOREALISTIC ARCHITECTURE'`
(`ModuleWorkspace.tsx`); the loading label (`'Rendering…'`) is unchanged.

### 2.4 Error UX — real, specific user-friendly messages

Before this build, a render failure showed the raw server `DomainError` message verbatim
(technically accurate, but not always a friendly sentence). `friendlyRenderErrorMessage()`
(new, `apps/web/src/api/errors.ts`) maps the real `providerCode` (BUILD 21/25's
`classifyProviderHttpStatus()` taxonomy, unchanged) to the exact sentences this build's spec
requires:

| `providerCode` | Message shown |
|---|---|
| `PROVIDER_QUOTA_EXCEEDED` | "Gemini quota/billing is unavailable. Please try later or use Mock Mode." |
| `PROVIDER_AUTH_FAILED` | "Gemini credentials are invalid or missing." |
| `PROVIDER_MODEL_NOT_FOUND` | "Selected image model is unavailable." |
| `PROVIDER_FORBIDDEN` / `PROVIDER_RATE_LIMITED` / `PROVIDER_TIMEOUT` / `PROVIDER_UNAVAILABLE` | a real, specific sentence for each |
| anything else (validation errors, unexpected client errors) | the real message, unchanged — never overridden |

The technical category (`error.code`) still renders alongside the friendly message in
`ErrorState` — this replaces only the message text, never hides the category, matching "message
+ technical category + retry guidance."

### 2.5 Result View actions — Download and Copy Image URL

Neither existed anywhere in the codebase before this build (verified by search). New
`ResultActions` component (`apps/web/src/components/ResultActions/`): a real `<a download>`
pointing at the actual, already-signed asset URL (no filename forced — the browser uses the
server's real `Content-Type` to pick the correct extension, never guessed), and a
"Copy Image URL" button using the real Clipboard API, with a real failure state (not a
silent no-op) if the browser denies clipboard access. "Render again"/"Change model"/"Change
prompt" needed no new UI — they are already the existing Render button and Scenario/Prompt
controls.

## 3. Deliberate scope decisions — not built, and why

- **No explicit 9-state render state machine UI** (`IDLE → VALIDATING → QUEUED → ANALYZING →
  GENERATING → VALIDATING_OUTPUT → QC → SAVING → READY`). The real backend performs generation
  as a single synchronous HTTP request/response — it has no mechanism to report intermediate
  phases like `QUEUED`/`ANALYZING`/`VALIDATING_OUTPUT` separately. Building UI states for
  phases the server can't actually report would be fabricating progress, not honest UX
  (CLAUDE.md rule 7's spirit). The existing `idle`/`loading`/`error` state machine already
  satisfies the real requirement this build names — "mọi async operation phải có terminal
  state, không spinner vô hạn" — verified: a success resolves to `idle` immediately, a failure
  resolves to `error` immediately, and the button is disabled for the entire `loading` window
  (duplicate-request guard).
- **No "MOCK MODE" UI badge/status widget.** The Mock Provider (BUILD 25) is deliberately never
  wired into `app-context.ts`'s real production `ImageGenerationService` — it is a test-time
  tool only. A real deployed user can never actually trigger Mock Mode, so a UI badge for a
  state that can't occur in production would be dead code, not a real feature. If a future
  build introduces a real, user-facing Mock Mode toggle, this badge becomes real work at that
  point, not before.
- **`SCENARIO_RESOLUTIONS`/`SCENARIO_ASPECT_RATIOS` themselves were NOT replaced** with this
  build's literal requested lists (`0.5K/1K/2K/4K`; `Auto,1:1,4:3,3:2,16:9,9:16,2:3,4:5,5:4,21:9`).
  These are shared, closed vocabularies also used by video generation (Veo,
  `veo-adapter.ts`/`VideoPanel.tsx`) — replacing them wholesale would have a materially larger
  blast radius than this build's UX-hardening mandate, touching video generation this build
  never asked to change. The real, actionable version of this request — never letting an
  unsupported combination reach a real provider — is fully satisfied by §2.2's per-model
  capability-aware disabling instead, without the cross-cutting risk.

## 4. QC gating — unchanged, and why

This build's spec describes QC as gating whether a result reaches "READY." The real,
existing architecture (BUILD 17, docs/15) treats QC as a separate, explicit, user-triggered
verification step *after* a generation has already succeeded and its asset already persisted
— not a blocking precondition for persistence. Changing this would be a real architecture
change to an already-working, tested pipeline, which this build's own rules forbid absent a
genuine defect. The Result View correctly displays whatever QC status exists (none until the
user runs it) rather than blocking on an automatic gate that doesn't exist server-side.

## 5. Verification performed

Automated: full regression suite (604/604 passing, +12 new tests over BUILD 25's 592; 3
correctly skipped by design), typecheck, lint, and production build all clean; the built
`apps/web` bundle re-grepped for every provider key/header name (zero matches, unchanged
verification method).

**Not performed this gate**: a live, interactive browser session driving the real dev server
end-to-end (the full auth/registration flow needed to reach the workspace, combined with this
gate's scope, made the jsdom-based component test suite — which renders the exact same React
output these changes produce — the practical verification path instead). This is disclosed
explicitly rather than claimed as done; the component-level assertions (exact button labels,
exact disabled states, exact error message text, real Clipboard/download attribute values) are
real DOM assertions against the real rendered output, not mocked UI.
