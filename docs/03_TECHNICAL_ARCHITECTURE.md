# Technical Architecture

Status: BUILD 01 — approved architecture, pre-implementation. No application code exists yet.
This document is the binding technical architecture for the Product Constitution (docs/00) and
Product Requirements (docs/01). It does not itself contain provider-specific request/response
schemas — those must be validated against current official provider documentation at
implementation time (CLAUDE.md rule 13), so none are fabricated here.

---

## 1. Architecture Decision Record

### ADR-001 — Lock taxonomy: Source-Fidelity Locks vs Output-Stability Locks
**Decision.** Locks split into two tiers with different purpose, default state, and priority behavior.

**Tier A — Source-Fidelity Locks: Architecture Lock, Camera Lock, Material Lock**
- Preserve facts *observed* by the Vision Analysis Engine in the source viewport (docs/05 layers 2, 4, 6).
- Default **ON** at project creation. Rationale: "Preserve before enhancing" is a core principle
  (docs/00), and CLAUDE.md rules 2–4 make preservation non-negotiable whenever the lock is enabled —
  the safe default is preservation, not drift.
- Pin target: the `structuredIntelligence` snapshot from the current `analysisVersion` (docs/04 Analysis).
- Reasoning Engine priority: tier 2 ("Explicit user locks and permissions"), directly below safety/system
  constraints, above Source Architecture DNA inference and everything scenario/reference/creative.
- Disabling one is always an explicit, attributed, audited user action — never silent (CLAUDE.md rule 5;
  see ADR-001 Lock model below).

**Tier B — Output-Stability Locks: Style Lock, Lighting Lock**
- Preserve a *previously accepted creative resolution* — not a fact the source geometry carries, since a
  raw SketchUp/3ds Max viewport has no real finish lighting and only an inferred/chosen style (docs/05
  layer 3: "Default Modern Contemporary when evidence is insufficient").
- Default **OFF** on first generation — Style and Lighting are ENHANCE-stage parameters the Scenario
  Builder (docs/07) is meant to freely explore. The product surfaces an **auto-suggest** to enable the
  lock once the user accepts a generation ("keep this look?"), but enabling still requires explicit
  user confirmation — never auto-enabled silently.
- Pin target: the resolved style/lighting fields of a specific accepted `GenerationVersion` (§7), not the
  source asset.
- Reasoning Engine priority: these do not sit at tier 2. They **pin the Style/Lighting sub-fields** of
  tiers 4–6 (User scenario/instructions, Reference purpose, Creative enhancement) to their last-accepted
  value while leaving every other field in those tiers free. They never outrank Tier A locks — if a
  conflict between Style Lock and Architecture Lock could ever arise, Architecture Lock wins (this should
  not happen structurally, since style and architecture are disjoint fields).
- `docs/06_REASONING_ENGINE_SPEC.md` is updated with this tiering (see diff below); this document is the
  authoritative rationale.

**Consequence for Data Model.** `docs/04_DATA_MODEL.md` Constraints section is upgraded from a flat
boolean list to a typed `Lock` value object per lock (see §7). `objectPermissions` is classified as a
Tier-A-adjacent structure (a per-object keep/edit/replace/add map, sourced from docs/05 layer 9) rather
than a binary lock — it is not renamed or removed.

### ADR-002 — Single `ai-core` package, internally module-bounded
**Decision.** Vision Analysis Engine, Reasoning Engine, Scenario Builder, Reference Intelligence, and AI
QC live as separate, strictly-bounded internal modules inside `packages/ai-core` (not five top-level
packages) at MVP.
**Rationale.** Each has a clean single-responsibility contract (§5) and the module boundary is what
matters for CLAUDE.md rule 9 (separation), not the package boundary. Splitting into five packages now
adds versioning/build overhead with no reuse benefit yet (rule 12: prefer small, reviewable structure).
**Trigger to split.** Promote a module to its own package only when it needs an independent deploy/scale
cadence (e.g., Vision Analysis running on GPU workers) or independent reuse outside this app.

### ADR-003 — Storage is accessed only through repository interfaces
**Decision.** `packages/project-core` defines storage-agnostic repository interfaces
(`ProjectRepository`, `AssetStore`, `GenerationRepository`, `VersionRepository`). Concrete
implementations live in `packages/storage-adapters` (e.g., a relational store + a blob store), never
referenced directly by `ai-core`, `prompt-engine`, or `apps/web`.
**Rationale.** Mirrors the provider-adapter pattern already mandated for image generation (docs/10) and
satisfies CLAUDE.md rule 9. Swapping the database or blob provider must not touch domain or AI code.

### ADR-004 — Async jobs behind a `JobQueue` interface, engine deferred
**Decision.** All long-running work (analysis, generation, video, QC) is submitted through a
`JobQueue` interface (`enqueue`, `getStatus`, idempotency-key support) implemented by `apps/api`. The
concrete queue technology is **not chosen in this document** — deferred to BUILD 02 (§13) so this
architecture doesn't imply a fake or unverified integration.
**Rationale.** docs/03 (prior) and docs/11 already require async jobs, retries, idempotency; the
interface boundary lets BUILD 02 pick a concrete engine without touching callers.

### ADR-005 — Relational store recommended for project/version/lock graph
**Decision (recommendation, confirmed at BUILD 02).** A relational database is recommended for
`Project`, `GenerationVersion`, `Lock`, and `Generation` (parent-linked, queryable, transactional), with
JSON/JSONB columns for the flexible `structuredIntelligence`, `DNA`, and `usageMetadata` payloads whose
shape evolves independently of the relational schema.
**Rationale.** The version/history model (§7) is a DAG that needs referential integrity; DNA/Structured
Intelligence payloads are AI-shaped and benefit from schema flexibility. No specific vendor is committed
here.

### ADR-006 — Version/history is an append-only DAG from MVP; the tree *UI* is Post-MVP
**Decision.** Every analysis, scenario resolution, generation, edit, and view creates a
`GenerationVersion` row linked to its `parentVersionId`, starting at MVP — never a destructive overwrite.
Only the interactive version-tree *navigation UI* is Post-MVP (docs/01, clarified in BUILD 00).
**Rationale.** Locks (Tier A pin to an analysis snapshot; Tier B pin to a generation version) and QC
regeneration (docs/15: "preserves all valid prior constraints") both require this history to exist
structurally before any UI is built on top of it, and CLAUDE.md rule 15 forbids silent data loss.

---

## 2. System Architecture

```
apps/web  (UI)
    │  HTTPS (typed API client)
    ▼
apps/api  (Application/API layer: auth, validation, orchestration, job submission)
    │
    ├─▶ packages/project-core      (domain: Project, DNA, Lock, Version, Constraints — pure domain, no I/O)
    ├─▶ packages/ai-core           (Vision Analysis → Reasoning → Scenario → Reference Intelligence → QC)
    ├─▶ packages/prompt-engine     (Structured Intelligence → Canonical Master Prompt)
    ├─▶ packages/model-adapters    (ImageGenerationService + provider adapters)
    └─▶ packages/storage-adapters  (repository implementations: relational store + blob store)
            │
            ▼
    external providers (NanoBanana / GoogleFlow / ChatGPTImage / future) — called only from
    model-adapters, only server-side (apps/api or a worker process), never from apps/web.
```

This refines the previously stated logical layer chain (Web UI → Application/API → Domain Core →
AI Vision/Reasoning → Prompt Compiler → Model Adapter → Generation Job → Storage → QC) into concrete
package ownership. The chain itself is unchanged and still governs allowed dependency direction:
**no layer may depend on a layer below it skipping the ones in between**, and no package may depend
"upward" (e.g., `project-core` must never import from `ai-core`, `model-adapters`, or `apps/api`).

---

## 3. Module Boundaries

| Package | Owns | Must NOT contain |
|---|---|---|
| `apps/web` | UI (docs/02), state binding, canvas, prompt inspector rendering | provider calls, secrets, business rule duplication |
| `apps/api` | authn/authz, request validation, job orchestration, API contracts (§8) | provider-specific request shapes, prompt template text |
| `packages/ui` | shared presentational components | domain logic, network calls |
| `packages/shared` | cross-cutting types, schema validators, error envelope | anything package-specific |
| `packages/project-core` | Project, DNA, Lock, Constraints, Version domain models + repository **interfaces** | any concrete DB/HTTP code |
| `packages/ai-core` | Vision Analysis Engine, Reasoning Engine, Scenario Builder, Reference Intelligence, AI QC (§5) | prompt text generation, provider calls |
| `packages/prompt-engine` | Analysis Prompt, Canonical Master Prompt, Provider Adapter Prompt (docs/09) | provider-specific formatting (that's the adapter's job) |
| `packages/model-adapters` | `ImageGenerationService`, `NanoBananaAdapter`, `GoogleFlowAdapter`, `ChatGPTImageAdapter`, `FutureAdapter` (§6) | domain rules, lock resolution |
| `packages/storage-adapters` | concrete `ProjectRepository`/`AssetStore`/etc. implementations | domain rules |
| `tests` | unit/integration/E2E/AI-eval per §10 | — |
| `infrastructure` | IaC, environment config (no secret values) | secret values |

Dependency direction, enforced (e.g., via lint boundary rules at BUILD 02):
`apps/* → packages/ai-core, prompt-engine, model-adapters, project-core, storage-adapters, ui, shared`
`ai-core, prompt-engine, model-adapters, storage-adapters → project-core, shared`
`project-core, shared → (nothing internal)`

---

## 4. Data-Flow Architecture

Mapped to CLAUDE.md's UNDERSTAND → PRESERVE → ENHANCE → CREATE → VERIFY philosophy — this is the first
document to name each stage's owning component explicitly:

1. **UNDERSTAND** — `apps/api` receives the uploaded viewport asset, stores it via `AssetStore`, and
   submits a `VisionAnalysis` job. `ai-core/vision-analysis` runs the 12-layer analysis (docs/05) and
   writes a `structuredIntelligence` snapshot (`Analysis`, docs/04) tagged with `analysisVersion`.
2. **PRESERVE** — `project-core` materializes default locks (Tier A **ON**, Tier B **OFF**) pinned to
   that `analysisVersion`. Nothing downstream may alter Architecture/Camera/Material DNA while its lock
   is enabled.
3. **ENHANCE** — The user drives Scenario Builder (docs/07) and, optionally, Reference Intelligence
   (docs/08). `ai-core/reasoning-engine` resolves conflicts using the priority order in §1/ADR-001 and
   docs/06, producing one **deterministic normalized request**.
4. **CREATE** — `prompt-engine` compiles the normalized request into the Canonical Master Prompt, then
   into a provider-specific prompt via the selected adapter's mapping. `model-adapters` submits the job,
   `apps/api` tracks status asynchronously (ADR-004), and outputs + provenance (CLAUDE.md rule 14) are
   persisted as a new `GenerationVersion`.
5. **VERIFY** — `ai-core/qc` scores the output against source + expected structured intent (docs/15). On
   fail, it emits a `correctionInstruction`; `apps/api` creates a regeneration job that re-enters step 4
   with the correction merged into the normalized request, preserving all still-valid constraints
   (docs/15) — it does not restart from step 1.

Every step writes provenance and a `GenerationVersion` row (ADR-006) before moving on — no step mutates
a prior version in place.

---

## 5. AI Pipeline Architecture

Each `ai-core` module has a narrow, testable contract:

- **Vision Analysis Engine** — `analyze(sourceAsset, module) → StructuredIntelligence` (12 layers,
  docs/05). Must emit `confidence`/`warnings` per layer when evidence is weak — never silently guesses
  without flagging uncertainty (feeds Reasoning Engine priority tier 1 safety awareness).
- **Reasoning Engine** — `resolve(structuredIntelligence, locks, scenario, references, instructions) →
  NormalizedRequest`, applying the priority order (docs/06, amended by ADR-001). Must separate observed
  facts from inferred assumptions and must surface — never silently drop — any unresolvable conflict
  (e.g., a Tier B lock pinned to a value the current scenario cannot satisfy).
- **Scenario Builder** — `normalize(scenarioInput) → NormalizedScenario` per docs/07's enumerated fields;
  purely a normalization/validation function, no I/O.
- **Reference Intelligence** — `extract(referenceAsset, purpose) → ExtractedVisualLanguage` (docs/08);
  enforces "reference transmits visual language according to purpose, never source architecture"
  (CLAUDE.md rule 5) structurally, by only ever returning fields relevant to the declared `purpose`.
- **AI QC** — `evaluate(source, normalizedRequest, output) → QCResult` (scores + issues + severity +
  `correctionInstruction`, docs/15).

Contract types live in `packages/shared` so `apps/api`, `ai-core`, and `prompt-engine` share one
definition — no duplicated business rules (CLAUDE.md rule 9/coding standards).

---

## 6. Provider Adapter Architecture

```ts
// packages/model-adapters
interface ImageGenerationAdapter {
  readonly id: 'nano-banana' | 'google-flow' | 'chatgpt-image' | string;
  capabilities(): AdapterCapabilities;              // resolution/aspect/edit support, declared not assumed
  validate(request: GenerationRequest): ValidationResult;
  generate(request: GenerationRequest): Promise<GenerationResult>;
  normalizeError(providerError: unknown): NormalizedAdapterError;  // maps to a shared retry classification
}

class ImageGenerationService {
  constructor(private adapters: Record<string, ImageGenerationAdapter>) {}
  resolve(renderCore: RenderCoreSelection): ImageGenerationAdapter; // 'Auto' picks by capability + policy
}
```

- `NanoBananaAdapter`, `GoogleFlowAdapter`, `ChatGPTImageAdapter` — each wraps one provider's real API.
  **No request/response schema is fixed in this document**; each adapter's implementation must be
  validated against that provider's current official documentation immediately before it is built
  (CLAUDE.md rule 13), consistent with README's "provider APIs and model capabilities change" note.
- `FutureAdapter` — not a real provider; a placeholder implementing the same interface, used only in
  tests to prove `ImageGenerationService` is provider-agnostic. Must never be wired into production
  render-core selection (would violate CLAUDE.md rule 7 — never fake an integration and label it real).
- The core (`ai-core`, `prompt-engine`, `apps/api`) depends only on `ImageGenerationAdapter`/
  `GenerationRequest`/`GenerationResult` — never on a provider SDK type, directly satisfying docs/10 and
  the prior docs/03's "core must not depend on provider-specific request formats."
- Retry classification is normalized (`retryable: boolean`, `reason`) so `apps/api`'s retry policy
  (bounded backoff, CLAUDE.md rule 15) is provider-agnostic.

---

## 7. State-Management Architecture

### Lock model (resolves ADR-001 into a concrete shape)
```ts
type LockId = 'architecture' | 'camera' | 'material' | 'style' | 'lighting';
type LockTier = 'source-fidelity' | 'output-stability';

interface Lock {
  id: LockId;
  tier: LockTier;                 // architecture/camera/material = source-fidelity; style/lighting = output-stability
  enabled: boolean;                // Tier A default true; Tier B default false
  pinnedRef: AnalysisVersionRef | GenerationVersionRef | null;
  setBy: UserId;
  setAt: Timestamp;
  reason?: string;
  history: LockChangeEvent[];      // append-only; disabling/enabling is always attributed, never silent
}
```
`objectPermissions` remains a separate structure: a per-object `{ objectId, action: 'keep'|'edit'|'replace'|'add' }`
map (docs/05 layer 9), not folded into `Lock`.

### Version/History model
```ts
interface GenerationVersion {
  id: string;
  projectId: string;
  parentVersionId: string | null;   // null only for the root (initial analysis)
  kind: 'analysis' | 'scenario' | 'generation' | 'edit' | 'view';
  snapshotRef: AssetRef | StructuredIntelligenceRef; // what this version actually captured
  createdAt: Timestamp;
  createdBy: UserId;
}
```
`Project.currentVersionId` (docs/04) always points into this DAG. Regeneration (VERIFY-stage failure)
creates a new version with the prior version as parent — it never mutates the failed version in place.

### Frontend state
`apps/web` holds one client-side `ProjectSession` store (current project, current version pointer, lock
states, in-flight job statuses) hydrated from `apps/api` and updated via typed API responses only —
no independent business logic duplicated client-side (locks are resolved server-side by the Reasoning
Engine; the client only reflects state and shows Prompt Inspector output, per docs/02).

### Job state machine
`queued → running → succeeded | failed | canceled`, with `failed` carrying a normalized error and
`retryable` flag; QC failure is not a job failure — QC runs as its own job with `decision: pass|fail`
feeding the next VERIFY→CREATE loop.

---

## 8. API/Service Contracts

Representative `apps/api` surface (finalized at BUILD 02; shapes here establish the contract boundary,
not the wire format):

```
POST   /projects
POST   /projects/:id/assets                 (upload source viewport)
POST   /projects/:id/analysis               → job (Vision Analysis Engine)
GET    /projects/:id/analysis/:analysisId
PATCH  /projects/:id/locks                  (enable/disable a Lock; always audited, §7)
POST   /projects/:id/scenarios              (normalize + persist a Scenario)
POST   /projects/:id/references             (upload + extract, purpose-scoped)
POST   /projects/:id/prompt/compile         → Canonical Master Prompt (Prompt Inspector data)
POST   /projects/:id/generations            → job (CREATE stage)
GET    /generations/:id                     (status/poll; async per ADR-004)
POST   /generations/:id/qc                  → job (VERIFY stage)
POST   /generations/:id/regenerate          (uses correctionInstruction; VERIFY→CREATE loop)
GET    /projects/:id/versions               (GenerationVersion DAG, read-only at MVP)
```

Shared error envelope (`packages/shared`): `{ code, message, retryable, providerCode?, requestId }` —
every AI action's failure reason (docs/02 UX rule) is derived directly from this envelope, never a raw
provider error passed through.

---

## 9. Security Architecture

- Secrets (provider API keys, DB credentials) live only in environment/secret-manager configuration,
  injected into `apps/api`/worker processes at runtime — never in `infrastructure` IaC files, never in
  `packages/model-adapters` source, never logged (CLAUDE.md rule 6; docs/16).
- Provider calls happen only server-side, only inside `packages/model-adapters` implementations invoked
  by `apps/api`/worker — `apps/web` never holds a provider credential.
- Upload validation at the API boundary: file type allowlist, size cap, dimension bounds, per-project
  upload permission check, before the asset ever reaches `AssetStore` (docs/16).
- Asset access is scoped per project/team via signed, time-limited URLs from `AssetStore` — no public
  bucket by default, since unreleased architectural designs are treated as confidential by default.
- Audit log (append-only) for: lock enable/disable, destructive/regenerate actions, deletions, asset
  access grants — satisfies docs/16 "audit sensitive operations" and CLAUDE.md rule 15.
- Rate limiting on analysis/generation/QC endpoints, keyed per user/project, to bound AI spend (docs/16).
- Retention/deletion policy for user assets: interface point identified (`AssetStore.scheduleDeletion`),
  concrete retention windows deferred to a product/legal decision (§13) — not fabricated here.

---

## 10. Testing Architecture

Maps docs/17 Test Strategy onto the module boundaries defined above:

- **Unit** — `project-core` (Lock resolution incl. Tier A/B interaction), `ai-core/reasoning-engine`
  (priority-order conflict resolution), `ai-core/scenario` (normalization), `prompt-engine` (compilation
  determinism/versioning).
- **Integration** — `storage-adapters` against a real (test) database/blob store; `model-adapters`
  against recorded fixtures/contract tests per provider (never live calls in CI, per rule 7 — no faked
  "real" integration, but also no accidental live spend); job lifecycle (`queued→...→succeeded/failed`)
  including idempotency-key replay; QC loop (fail → correctionInstruction → regenerate → new version).
- **E2E** — the docs/17 golden path (create → upload → analyze → scenario → prompt → generate → QC →
  regenerate) run against `apps/web` + `apps/api` in a staging-like environment.
- **AI evaluation** — a fixed `/test-dataset` (flagged missing in BUILD 00; must exist before BUILD 07)
  drives Vision Analysis Engine and QC scoring regression checks — evaluating structured-analysis
  quality and consistency, not just "did a request return an image" (docs/17).
- Adapter contract tests assert every `ImageGenerationAdapter` implementation satisfies the same
  interface behavior (capability declaration, validation, normalized errors) so `FutureAdapter` and a
  real provider adapter are interchangeable from the core's point of view — proving ADR-002/§6's
  provider-agnosticism claim rather than asserting it.

---

## 11. Deployment Architecture

- **Environments**: dev / staging / production, each with isolated secrets, storage, and provider
  credentials (never shared across environments).
- **Services**: `apps/web` (static/SSR), `apps/api` (stateless HTTP), a worker process for async jobs
  (analysis/generation/video/QC) sharing `ai-core`/`model-adapters`/`storage-adapters` code with `apps/api`
  rather than duplicating logic.
- **Data**: relational store (ADR-005) for Project/Version/Lock/Generation metadata; blob store for
  source/reference/output assets; queue (ADR-004) for job orchestration.
- **Observability**: structured logging (with secret redaction), metrics (job latency/failure rate,
  provider error rates, QC pass rate), tracing across API→job→adapter→provider, and error reporting —
  satisfying CLAUDE.md coding standard "Observable production services." Concrete vendor choices are a
  BUILD 02/18 decision, not fixed here.
- **Scaling**: `apps/api` and the worker scale independently (worker is the AI/provider-bound bottleneck);
  provider adapters carry their own rate-limit awareness so one provider's throttling doesn't starve
  others when `ImageGenerationService` routes across them.

---

## 12. Technical Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Provider API drift/capability mismatch vs. what an adapter assumes | Capability declaration + adapter contract tests + mandatory doc-check before each adapter's implementation (rule 13) |
| Duplicate/timed-out long-running generation or video jobs | Idempotency keys on job submission; async status polling; provider adapter dedupe where the provider supports it |
| Tier B lock pinned to a value the current scenario/reference cannot satisfy | Reasoning Engine must surface the conflict explicitly to the user/UI, never silently drop the lock or silently re-roll the value |
| Vision Analysis hallucination on ambiguous/low-detail viewport renders | Per-layer `confidence`/`warnings` are mandatory output, propagated to Reasoning Engine and UI — never only logged |
| Cost/latency blowup from multi-provider "Auto" routing or repeated 8K upscales | Usage/cost tracking + rate limiting + resolution tiering (preview before full-res), per docs/03 prior operational requirements |
| Regeneration silently overwriting an accepted output | Append-only `GenerationVersion` DAG (ADR-006) — regeneration always creates a new version |
| Secret leakage via logs/error payloads | Structured logging redacts known secret field names; adapters never log raw provider request/response bodies |
| Package boundary erosion over time (rule 9 violated incrementally) | Lint-enforced dependency-direction rules (§3) at BUILD 02 bootstrap |

---

## 13. Decisions Requiring Future Implementation

Explicitly deferred — not ambiguous, just not yet due:

- **Resolved at BUILD 18**: concrete relational database engine and blob storage — `node:sqlite`
  (`SqliteDatabase`) and local disk (`LocalDiskAssetStore`), both real and zero-external-vendor (§30/§31).
  A managed cloud swap (Postgres/S3/etc.) stays a real, still-open future decision, but only behind these
  same repository/`AssetStore` interfaces — no caller-visible change if/when it happens.
- Concrete cloud/hosting provider and IaC tooling — still open (no account/credentials to wire against).
- Concrete job queue technology behind the `JobQueue` interface (still `InMemoryJobQueue`, single-process
  only) — still open; a real multi-instance deployment needs a shared backend (Redis/SQS/etc.).
- **Resolved at RELEASE 02**: real accounts/session model — email+password (real scrypt hashing), real
  server-side revocable sessions via an HTTP-only `SameSite=Strict` cookie, real per-project ownership
  enforcement (§32). A managed identity provider (Auth0/Clerk/etc.) stays a real, still-open future decision,
  behind the same `UserRepository`/`SessionRepository` interfaces.
- Exact request/response schemas for NanoBanana, Google Flow, and ChatGPT Image adapters — validated
  against each provider's current official documentation at BUILD 12, not fabricated in this document.
- Concrete observability vendor/stack — BUILD 18 added vendor-agnostic HTTP-request counters
  (`GET /metrics`, Prometheus text format); a managed backend (Datadog/Grafana/etc.) and latency
  histograms/tracing stay open.
- Exact *automatic* retention/deletion policy timeframes for user assets (docs/16) — a product/legal
  decision, still open; BUILD 18 made on-demand deletion itself real (`DELETE /projects/:id/assets/:assetId`).
- UX mechanics for the Style/Lighting Lock "keep this look?" auto-suggest moment (BUILD 03 / BUILD 09).
- Interactive version-tree UI (Post-MVP, docs/01) built on top of the MVP-level `GenerationVersion` DAG.
- `PATCH /projects/:id/locks` — locks are still resolved entirely client-side; no server-side lock
  persistence/audit exists (a pre-existing gap since BUILD 02, reconfirmed still open at BUILD 18 when the
  audit log was added — lock changes are the one docs/03 §9 audit category this gate could not cover).

---

## 14. BUILD 02 Bootstrap Implementation Record

Concrete tooling choices made at Bootstrap, where §13 left the engine open. These are pragmatic,
reversible scaffolding choices, not the final ADR-004/ADR-005 vendor decisions:

- **Package manager**: npm workspaces (Node 20+, npm 10+ already vendors this — no extra install).
- **Language/build**: TypeScript 5.6 strict mode, `NodeNext` ESM, project references (`tsc -b`) for
  incremental cross-package builds, matching package boundaries 1:1 with `references` entries.
- **Lint/format**: ESLint 9 flat config + `typescript-eslint`; Prettier for formatting. Both run across
  the whole workspace from the root, not per-package.
- **Test runner**: Vitest, aliasing `@avs/*` package specifiers to each package's `src/index.ts` so
  `npm test` never depends on a prior build having run.
- **Schema validation**: `zod`, adopted in `packages/shared` for the environment schema — the concrete
  library backing CLAUDE.md's "Schema validation at system boundaries" coding standard.
- **`JobQueue` (ADR-004) and storage repositories (ADR-003/ADR-005) at Bootstrap**: implemented only as
  `InMemoryJobQueue` / `InMemoryProjectRepository` / `InMemoryAssetStore` / `InMemoryVersionRepository` /
  `InMemoryGenerationRepository` — explicitly dev/test reference implementations, not the production
  database/queue. The real vendor selection in §13 is still open.
- **`apps/api` HTTP layer**: plain `node:http`, one `/health` route. No framework (Express/Fastify/etc.)
  committed yet — deferred until BUILD 06 needs real endpoints, to avoid a premature dependency (rule 12).
- **`apps/web`**: no UI rendering framework selected — that remains a BUILD 03 decision. Bootstrap adds
  only a typed `ProjectSessionState`/`ProjectSessionStore` (§7) and a typed route table for the
  Architecture/Interior/Project shell sections (docs/02 Navigation), both framework-agnostic.
- **Service-boundary naming**: docs/03 §5 names (`VisionAnalysisEngine`, `ReasoningEngine`,
  `ScenarioBuilder`, `ReferenceIntelligence`, `AiQc`, `PromptCompiler`) are kept as the primary contracts;
  `VisionAnalysisService`, `ReasoningService`, `ScenarioService`, `ReferenceIntelligenceService`,
  `AIQCService`, and `PromptCompilerService` are added as same-type aliases so both naming conventions
  resolve to one contract, never two.
- **Provider adapters**: `NanoBananaAdapter`, `GoogleFlowAdapter`, `ChatGPTImageAdapter` exist as classes
  implementing `ImageGenerationAdapter` whose `generate()` throws `NOT_IMPLEMENTED` (owning gate: BUILD
  12) — declared contracts, never a simulated provider response (CLAUDE.md rule 7). `FutureAdapter`
  remains the only adapter with a real, working `generate()`, used solely to prove the core is
  provider-agnostic (§6, §10).

## 15. BUILD 03 UI/UX Foundation Implementation Record

Concrete choices made at the UI/UX Foundation gate, resolving the frontend-framework decision left open
by §14, plus the shell architecture built on top of it:

- **Frontend framework**: React 18 + Vite + TypeScript. Chosen over a framework-less approach because
  the shell already needs component reuse, `useSyncExternalStore` (for binding to the BUILD 02
  `ProjectSessionStore`), and a real production build — Vite gives that with the smallest possible
  dependency footprint (no meta-framework, no SSR, no router library).
- **Styling**: CSS Modules, no CSS-in-JS or utility-framework dependency. Design tokens (color, spacing,
  type) centralized in `apps/web/src/styles/tokens.css`; every component's `.module.css` consumes them —
  no ad hoc colors.
- **Routing**: no router dependency. `apps/web/src/state/router.tsx` is a minimal `useSyncExternalStore`
  binding directly on top of BUILD 02's typed `routes.ts` (`ROUTES`/`resolveRoute`) plus
  `history.pushState`, per BUILD 03's instruction to reuse the existing routing approach rather than
  replace it.
- **State**: no state-management library. `apps/web/src/state/ProjectSessionContext.tsx` is a thin React
  binding (`useSyncExternalStore`) over the one `ProjectSessionStore` from BUILD 02 — still the only
  global state system. `ProjectSessionState` gained one additive field, `promptDraft: string` — the
  Prompt Editor's pre-compiler draft text, distinct from `prompt: CanonicalMasterPrompt | null` (which
  stays null until BUILD 11's compiler exists).
- **`apps/web` build**: no longer part of the root `tsc -b` composite project-reference graph (a Vite app
  is a leaf consumer, not a library other packages import) — it has its own `tsc --noEmit` typecheck and
  `vite build` production build, both wired into the root `typecheck`/`build` scripts. `vite.config.ts`
  aliases `@avs/*` to package source (mirroring `vitest.config.ts`), so `vite dev`/`vite build` never
  depend on the library packages having been `tsc`-built first.
- **Component testing**: Vitest + `@testing-library/react` + `jsdom`, scoped to `apps/web/**` only via
  `environmentMatchGlobs` (everything else stays on the faster `node` environment). RTL's automatic
  `cleanup()` needs Vitest's global `afterEach`, which isn't registered (no `test.globals: true`) — wired
  explicitly once in `apps/web/src/test-setup.ts` instead of per test file.
- **Lint**: `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y` added, scoped to `apps/web/**/*.{ts,tsx}`
  — accessibility is an explicit hard requirement for this gate, not optional lint hygiene.
- **Lock Controls UI**: renders the real `Lock`/`LockState` shape from `packages/project-core`, ordered
  source-fidelity before output-stability (visually encoding the docs/06 priority). Shows an honest empty
  state ("Locks become available after analysis") rather than fabricating a default `Lock[]` — no Vision
  Analysis Engine exists yet to produce the `analysisVersion` a source-fidelity lock must pin to.
- **Scenario Slots UI**: every docs/07 field rendered as a real, keyboard-accessible, interactive select,
  but its value is component-local draft state — never written to `ProjectSessionState.scenario`, which
  holds only the *normalized* output of `ScenarioBuilder.normalize()` (BUILD 09).
- **Right-side panel**: `Panel` is a generic collapsible/contextual component, closed by default. There is
  no permanent wide AI Analysis Panel anywhere in the shell — this was an explicit constraint for this
  gate and is enforced structurally (the only right-side content mount point collapses to 40px).
- **Canvas**: defaults to a 2:3 portrait frame via an `aspectRatio` prop (`aspectRatioToCss`), not a
  layout assumption — Scenario Builder's aspect-ratio field (BUILD 09) can change it without any shell
  redesign.

## 16. BUILD 04 Architecture Module Implementation Record

BUILD 04 was invoked without a detailed instruction set — scope was derived from docs/19's gate ordering
and this document's own prior notes, recorded here for traceability:

- **Scope decision.** `apps/api/src/server.ts`'s own BUILD 02/03 comment already states real endpoints
  (`POST /projects` included, docs/03 §8) land at "BUILD 06+" (Image Ingestion). Building real project
  persistence now would contradict that prior decision without a documented reason (CLAUDE.md rule 8), so
  BUILD 04 does **not** implement project creation/API. Instead, "Architecture Module" is read as:
  specialize the Architecture module's domain vocabulary and give it a real, distinct identity in the
  BUILD 03 shell — still no AI, no backend, no persistence.
- **Domain**: `packages/project-core/src/architecture-module.ts` — closed reference vocabularies for
  docs/05 layer 2 (roof/opening/facade/stair types) and layer 9 scoped to exterior/site objects
  (landscaping, vehicle, entry-feature, etc.), distinct from `InteriorDNA`'s furniture concerns (BUILD 05's
  module to specialize). Pure static reference data — `describeArchitectureModule()` calls no AI, no I/O.
- **UI**: `ArchitectureFocus` renders that vocabulary inside the existing collapsible Inspector `Panel`
  (docs/02 UX "Canvas gets priority over secondary analysis panels") when `module === 'architecture'`;
  Interior keeps BUILD 03's generic placeholder untouched, preserving a clean scope boundary for BUILD 05.
  Verified live in-browser: expands/collapses correctly, canvas stays dominant and portrait, Interior route
  shows no Architecture content.

## 17. BUILD 05 Interior Module Implementation Record

Executed with no detailed instruction set, mirroring BUILD 04's shape exactly (as recommended in that
gate's report) rather than reinterpreting scope from scratch:

- **Domain**: `packages/project-core/src/interior-module.ts` — closed reference vocabularies for
  `InteriorDNA`'s fields (`dna.ts`, BUILD 02): spatial layout types, wall treatments, floor finishes,
  ceiling treatments, and furniture/decor object categories (docs/05 layer 9, scoped to furnishing —
  distinct from `ArchitectureDNA`'s exterior/site vocabulary, BUILD 04). Pure static reference data —
  `describeInteriorModule()` calls no AI, no I/O; a test asserts its object-category vocabulary never
  overlaps Architecture's.
- **UI**: `InteriorFocus` mirrors `ArchitectureFocus` exactly (same section/chip structure, same "BUILD 07"
  badge marking where real analysis will attach) and replaces the BUILD 03/04 generic Interior placeholder
  in `Workspace`'s Inspector branch — both modules now have a real, distinct, verified-live identity;
  neither fabricates an analysis result. Verified live in-browser on both `/architecture` and `/interior`:
  correct vocabulary renders per module, no cross-contamination, canvas stays dominant and portrait.

## 18. BUILD 06 Image Ingestion Implementation Record

The first gate with a real client-server integration — `apps/api` gains actual persisted endpoints, per
the standing decision (docs/03 §14/§16) that this was the correct point to add them, not earlier:

- **New endpoints**: `POST /projects` (docs/01 MVP step 1 + 3), `GET /projects/:id`,
  `POST /projects/:id/assets` (MVP step 2), `GET /assets/:id`. All validated at the boundary with `zod`
  (`schemas.ts`) or explicit checks (`upload-validation.ts`) — CLAUDE.md "Schema validation at system
  boundaries."
- **Upload validation (docs/16)**: content-type allowlist (`image/png`, `image/jpeg`), a 20 MB size cap
  enforced *while streaming* (`read-body.ts` aborts the connection the moment the limit is crossed, so an
  oversized body is never fully buffered — the naive version of this check would itself be the DoS vector
  docs/16 asks it to prevent), and real pixel-dimension validation (16000px/side cap) via a from-scratch
  PNG IHDR / JPEG SOF0 header parser (`upload-validation.ts`) — deliberately no image-library dependency
  for two fixed, well-documented binary formats.
- **`AssetStore` interface change (project-core, ADR-003)**: added `get(id)` returning the stored bytes,
  not just metadata — the prior `InMemoryAssetStore.put()` only ever stored an `AssetRef`, meaning nothing
  could actually be served back. This was a real Bootstrap-era gap, not a deliberate deferral; fixed here
  because Image Ingestion is the first gate that needs to serve an uploaded asset back to a browser.
- **CORS**: permissive (`Access-Control-Allow-Origin: *`) since apps/web (Vite) and apps/api run on
  different origins locally and no credentials are ever sent. Explicitly flagged in `cors.ts` and here as
  needing an explicit allowlist before BUILD 18 Production Hardening — not silently left permissive.
- **Frontend (`apps/web/src/api/client.ts`)**: `createProject`/`uploadAsset` thin fetch wrappers, using
  Vite's `import.meta.env.VITE_API_BASE_URL` (defaulting to `http://localhost:8080`) — deliberately *not*
  routed through `packages/shared`'s `parseServerEnv`, which is Node `process.env`-based and has no
  meaning in a browser bundle. `ControlPanel` now lazily creates a `Project` on first upload (module comes
  from the already-selected Architecture/Interior route) and reuses it on subsequent uploads; every
  upload's loading/error state is real (`ProjectSessionState.status`/`error`), never simulated.
- **Verified live, not just in tests**: curl-level round trip (create project → upload a real PNG → fetch
  it back → byte-for-byte identical), rejection paths (415 unsupported type, 404 unknown project, CORS
  preflight), and a full browser-level pass — a real `File` dispatched through the actual mounted
  `<input>` in a running Vite page against a running API server, confirmed via `document.querySelector('img').src`
  resolving to `http://localhost:8080/assets/asset-2` (id incrementing correctly across the earlier curl
  session against the same server process — real shared server state, not per-test mocking) and the
  Header showing the real created project name/timestamp instead of "No project selected".

## 19. BUILD 07 Vision Analysis Engine Implementation Record

**Provider decision (asked, not assumed):** the user chose **Google Gemini** for the 12-layer Vision
Analysis Engine, and confirmed no `GEMINI_API_KEY` was available yet — build the real integration, do not
live-test it. This was asked rather than decided unilaterally because it commits the user to a specific
paid vendor/account, unlike every prior gate's implementation choices.

- **API validated against current docs (2026-09-04, not memory)**: `packages/ai-core/src/gemini-vision-engine.ts`
  cites the exact pages fetched — Gemini's **Interactions API** (`POST
  https://generativelanguage.googleapis.com/v1beta/interactions`, `x-goog-api-key` header, `response_format`
  structured-output field) rather than the older `generateContent` endpoint, confirmed consistently across
  three independent fetches (quickstart, text-generation, structured-output pages) before being used in code
  — CLAUDE.md rule 13. **Live behavior remains unverified** — flagged in the file's own header comment, not
  just this record, so the gap survives future edits.
- **Structured Intelligence schema** (`structured-intelligence-schema.ts`): replaces the loose
  `Record<string, unknown>` placeholder BUILD 02 deliberately left open ("Bootstrap does not invent a data
  contract that gate must own" — this is that gate). All 12 docs/05 layers, each with `confidence` +
  `warnings` (docs/05 "include confidence/uncertainty where evidence is weak"), enforced with `zod` on the
  response — a malformed or incomplete model response is rejected outright, never partially accepted.
- **Prompt construction reuses BUILD 04/05's module vocabulary** (`architecture-module.ts` /
  `interior-module.ts`) as guidance text, so the "closed vocabulary" work from those gates isn't just UI
  decoration — it now shapes what the real model is asked to prefer.
- **`SourceAssetRef` redesigned** to carry actual bytes + contentType, not a URL the engine fetches itself
  — the caller (apps/api) already has the bytes from `AssetStore.get()`; an engine that fetches an
  arbitrary caller-supplied URL is an SSRF-shaped design this avoids entirely.
- **`PROVIDER_NOT_CONFIGURED` (503) vs `NOT_IMPLEMENTED` (501)**: a deliberate new distinction. Every other
  still-pending ai-core module throws `NOT_IMPLEMENTED` ("no code exists yet"); the Gemini engine is real,
  implemented code that throws `PROVIDER_NOT_CONFIGURED` only because no key is present — a materially
  different, more honest signal than pretending the feature doesn't exist.
- **`AnalysisRepository` added** (project-core, storage-adapters) to honor ADR-006, which was already
  written but unfulfilled: "every analysis... creates a GenerationVersion... starting at MVP." `structuredIntelligence`
  is stored as `unknown` in the repository — project-core must not depend on ai-core (§3 dependency
  direction), so apps/api (which depends on both) is the layer that casts it back.
- **`POST /projects/:id/analysis`**: looks up the project and asset (rejecting an asset that doesn't
  belong to the project as 404, not a silent cross-project leak), calls the engine, persists the
  `AnalysisRecord`, creates a `GenerationVersion` (kind: `analysis`, `parentVersionId` from the project's
  prior `currentVersionId`), and only then advances `Project.currentVersionId` — verified live that a
  failed analysis (503) leaves zero partial state (`currentVersionId` still `''`, no orphaned version).
- **Frontend**: `ControlPanel`'s new "Analyze source image" action is the first point in the entire build
  where `LockControlGroup` renders real, not empty, state — `createDefaultLocks()` (BUILD 01/02) is called
  with the real `analysisVersion` on success. Deliberately does **not** map `StructuredIntelligence` into
  `ProjectDNA` — that resolution is the Reasoning Engine's job (docs/06, BUILD 08); doing it here would
  implement that gate prematurely. The raw result is held in a new `ProjectSessionState.structuredIntelligence`
  field instead.
- **Verified live end-to-end** (real servers, no mocks): curl round trip — create project → upload → run
  analysis → real `503 PROVIDER_NOT_CONFIGURED`, confirmed the project's `currentVersionId` stayed `''`
  (no partial state). Browser-level pass — a real `File` dispatched through the actual `<input>`, clicked
  the real "Analyze source image" button, confirmed via the network log (`OPTIONS 204` preflight then
  `POST 503`) and the rendered UI: the real `ErrorState` with the exact server message, `Dismiss` (not
  `Retry`, since `retryable: false` — the component correctly read that field), the Header status badge
  turning red, and Locks correctly staying in their empty state rather than showing fabricated data.

## 20. BUILD 08 Reasoning Engine Implementation Record

Unlike every gate since BUILD 06, this one needed no external provider and no new API/UI surface — pure
domain logic, verified by the automated test suite docs/17 already names for it ("Unit — ... lock
resolution").

- **Scope decision**: `reasoningEngine.resolve()` is implemented for real and thoroughly tested (31
  ai-core tests, 18 of them new), but **no new API endpoint or UI wiring was added**. Its typical callers —
  a real Scenario Builder (BUILD 09) and Reference Intelligence (BUILD 10) — don't exist yet; `NormalizedScenario`
  requires all fields as non-optional strings, so fabricating a placeholder "no scenario chosen yet" object
  to wire into a premature endpoint would mean inventing fake scenario data, which this avoids.
- **`deriveProjectDNA()`** (`project-dna-mapping.ts`) fulfills the mapping BUILD 07 explicitly deferred here
  — a pure function, no I/O, no inference beyond what Vision Analysis already observed (docs/06 "separate
  facts observed from inferred assumptions" — this is the *observed* half).
- **`ProjectDNA` sub-types corrected**: `CameraDNA.eyeLevel`/`verticalCorrection`, `MaterialDNA`'s
  roughness/reflectance, and `LightingDNA`'s intensity/softness/colorTemperature were typed as numbers by
  BUILD 02's placeholder guess; a vision-language model reports these qualitatively ("standing eye level",
  "low roughness"), not as measured values — corrected now that this shape is first actually populated,
  per BUILD 02's own comment inviting exactly this correction. `ProjectDNA.cameraDNA`/`materialDNA`/
  `lightingDNA`/`environmentDNA` also narrowed from nullable to required — they're populated by every real
  analysis regardless of module; only `architectureDNA`/`interiorDNA` (module-conditional) and
  `referenceDNA` (BUILD 10 territory) stay nullable.
- **Conflict model is new**: `ResolvedConflict[]` on `NormalizedRequest` — every override this engine makes
  is recorded, always in the response, never only logged (docs/06 "never override explicit locks without
  an explicit user action"). Tier A (Architecture/Camera/Material) conflicts fire when an enabled lock
  actually suppresses a competing scenario/reference input, or when confidence is low even though the lock
  still wins; Tier B (Style/Lighting) conflicts fire when a lock can't actually be honored because the
  caller supplied no `pinnedOutputStability` value to pin to (a real, honestly-reported degraded case, not
  a silent no-op) — see ADR-001's `OutputStabilityPins` contract, which documents that ai-core has no
  `VersionRepository` access, so the caller must resolve a Tier B lock's `GenerationVersionRef` into real
  values before calling `resolve()`.
- **Priority order implemented concretely, not just documented**: Camera Lock forces `scenario.cameraMode`
  back to `'Preserve Original'` on conflict; unlocked lighting lets `scenario.lighting` (tier 4) outrank the
  source observation (tier 3), matching docs/06's priority list exactly rather than only describing it.
- **`INVALID_LOCK_SET`**: tier-1 safety validation — `resolve()` rejects outright if the caller's lock array
  is missing an id or has a tier not matching `LOCK_TIER` (docs/03 ADR-001's fixed assignment), rather than
  resolving against a malformed lock set.

## 21. BUILD 09 Scenario Builder Implementation Record

Pure domain logic again — no external provider, and unlike BUILD 08, this one *does* get real UI wiring,
since `ScenarioSlots` (BUILD 03) already existed with local-only draft state waiting for exactly this gate.

- **`scenario-vocabulary.ts`**: docs/07's nine closed vocabularies as literal arrays — the single source of
  truth both `scenario.ts`'s validator and `ScenarioSlots`' `<select>` options now read from, so the UI
  cannot even present a value the domain layer would reject.
- **`normalize()`** validates every field case/whitespace-insensitively against its vocabulary, canonicalizes
  to the docs/07 casing, and — unlike BUILD 06/07's fail-on-first-error style — collects **every** invalid
  field into one error message rather than stopping at the first, since a user re-submitting a 9-field form
  benefits from seeing all problems at once.
- **Real bug found and fixed in the BUILD 03 UI**: `ScenarioSlots` had a single "Resolution" field, but
  `ScenarioInput` (correctly, since BUILD 02) has two distinct fields — `generationResolution` and
  `upscaleResolution` (docs/07 "keep generation and upscale resolution distinct"). Fixed now that the UI is
  actually being wired to the real contract it was always supposed to match. `artificialLighting` (a
  `string[]`) was also a single-select `<select>` in the old UI — replaced with a checkbox group, matching
  its real multi-select domain shape.
- **Normalization runs entirely client-side** — `scenarioBuilder.normalize()` is pure (no I/O), so
  `ScenarioSlots` calls it directly in the browser with no network round trip, the same pattern already
  established for `describeArchitectureModule()`/`describeInteriorModule()` (BUILD 04/05).
- **Shared `toErrorEnvelope` helper extracted** (`apps/web/src/api/errors.ts`): `ControlPanel` (BUILD 06/07)
  had its own copy handling only `ApiError` (network failures); `scenarioBuilder.normalize()` throws a real
  `DomainError` directly (no network involved), which the old copy didn't handle correctly. One shared,
  properly-typed helper now covers both cases (CLAUDE.md "No duplicated business rules") — used by both
  `ControlPanel` and `ScenarioSlots`.
- **Real bundle-size regression found and fixed**: `apps/web`'s first-ever runtime import from `@avs/shared`
  (via the new `errors.ts`) pulled the entire `zod` library into the client bundle (169KB → 225KB gzipped
  54.93KB → 68.14KB) — none of the six workspace packages declared `"sideEffects": false` in their
  `package.json`, so Rollup couldn't prove `packages/shared/src/env.ts`'s unused, zod-based server-env
  schemas were safe to drop. Added `"sideEffects": false` to all six package.json files (the standard fix,
  not a restructure) — confirmed empirically the bundle returned to baseline. Also removed a genuinely dead
  BUILD 07 leftover in the process: `gemini-vision-engine.ts`'s module-level `visionAnalysisEngine` singleton
  was never used by any real code path (`apps/api` always constructs its own instance via `createAppContext()`)
  — only by its own test file, which now constructs one locally instead.
- **Verified live in-browser**: filled all 9 fields plus two Artificial Lighting checkboxes through the real
  rendered `<select>`/`<input>` elements, clicked the real "Apply Scenario" button, confirmed the status
  badge flipped from "Draft" to a real green "Applied" (not a hardcoded label) both visually and via
  `document.querySelectorAll` reading back the actual checked checkboxes.

## 22. Architecture Amendment — Bilingual + Prompt Intelligence Engine + User Visual Preference DNA

Contracts-and-architecture only, inserted between BUILD 09 and BUILD 10. Per the amendment instruction, this
gate implements **types, pure mapping/derivation functions, and their tests** — no provider calls, no BUILD 09
Scenario Builder work (already done, see §21), and no BUILD 11 Master Prompt Compiler implementation
(`PromptCompiler.compile()` remains `NOT_IMPLEMENTED`).

**Note on sequencing**: this amendment's instructions state "BUILD 00–08 have passed. Do NOT execute BUILD 09
yet," assuming BUILD 09 had not started. In this session BUILD 09 (§21) had already been executed and passed
in the prior turn before this amendment arrived. Existing BUILD 09 code was **not reverted** — reverting
working, tested code without a documented defect would itself violate CLAUDE.md rule 8. The amendment was
applied additively on top of the current state instead.

### Bilingual architecture (`packages/shared/src/language.ts`)
Three **independent** settings — `LanguageConfig { uiLanguage: Language; aiAnalysisLanguage: Language |
'auto'; promptOutputLanguage: Language | 'auto' }` (`Language = 'vi' | 'en'`) — deliberately not one global
locale, since the amendment requires UI language, AI analysis language, and prompt output language to vary
independently (e.g. Vietnamese UI, English analysis, bilingual prompt output). `resolveAutoLanguage()` turns
`'auto'` into a concrete language from the UI language, keeping `'auto'` out of downstream code that needs a
concrete value. `BilingualText { en, vi }` is the one shape carried through the rest of the pipeline.
Business/domain identifiers (`LockId`, `ReferencePurpose`, layer names, vocabulary values) remain plain
English string literals — language-neutral, per the amendment — bilingual text exists only at the
presentation/prompt boundary, never in domain models.

### Prompt Intelligence Engine (contracts, not implementation)
`packages/prompt-engine/src/prompt-intelligence-pipeline.ts` names all eleven amendment-specified stages
(`SOURCE IMAGE` → ... → `MODEL ADAPTER`) each mapped to a real owning component and Build Gate — this is the
map the rest of §22 implements pieces of:

| Stage | Owner | Build Gate |
|---|---|---|
| SOURCE IMAGE / IMAGE VISION | `visionAnalysisEngine` | BUILD 07 |
| STRUCTURED INTELLIGENCE | `StructuredIntelligence` (12-layer) | BUILD 07 |
| VISUAL LANGUAGE EXTRACTION | `reference-intelligence.ts` | BUILD 10 |
| SOURCE/REFERENCE SEPARATION | `source-reference-separation.ts` | Architecture Amendment (§22) |
| LOCK & CONSTRAINT RESOLUTION | `reasoning-engine.ts` / `structural-constraints.ts` | BUILD 08 / §22 |
| USER PREFERENCE APPLICATION | `user-preference-application.ts` | §22 |
| MASTER PROMPT COMPILATION | `compiler.ts` (`PromptCompiler`) | BUILD 11 |
| PROMPT INSPECTION | `prompt-inspector.ts` | §22 (contract), UI wiring TBD |
| USER APPROVAL/EDIT | `applyPromptInspectorEdit()` | §22 (contract), UI wiring TBD |
| MODEL ADAPTER | `model-adapters` package | BUILD 12+ |

`mapNormalizedRequestToPromptIntelligence()` (`prompt-intelligence.ts`) is the one real mapping function
implemented this gate: it takes BUILD 08's `NormalizedRequest` and produces `PromptIntelligence`, translating
each of the 12 structured-intelligence layers into a canonical-prompt-facing field. Per "no fake AI calls,"
bilingual text fields are produced by `mirrorAsPromptFieldValue()`, which **mirrors** single-language source
text into both `en`/`vi` with an explicit warning
(`'Not translated — single-language source text pending real bilingual generation (BUILD 11).'`) rather than
fabricating a translation — real bilingual generation is BUILD 11's job.

### Canonical Prompt DNA (`packages/prompt-engine/src/canonical-prompt-dna.ts`)
Preserves the user's pre-existing structure verbatim as a first-class, enforced type — not a description in
this doc that code can silently drift from: `CANONICAL_PROMPT_SECTION_ORDER` (Real-life photography / Ảnh
chụp thực tế → Subject/Space → Style → Details → Context → Lighting → Camera & Photography System →
Technical/Structural Control) plus the required "Complete copy/paste Prompt" deliverable, bilingual.
`assertConciseKeywordStyle()` enforces "concise keyword-oriented output" as a runtime check (throws over the
40-word threshold), not just a convention. This is deliberately a **wrapper contract** around the existing
docs/09 three-level model (§ below) — `PromptOutput` (`prompt-output.ts`) carries both the existing
`CanonicalMasterPrompt` (docs/09's 14-section shape, BUILD 11's compile target) and the new
`CanonicalPromptDNA` side by side; docs/09's conceptual model is not replaced.

### Source vs. reference separation (`packages/ai-core/src/source-reference-separation.ts`)
`SourceArchitectureDNA` and `ReferenceVisualLanguage` are **type aliases** to the existing `ArchitectureDNA`
and `ExtractedVisualLanguage` (CLAUDE.md "no duplicated business rules") — not new parallel types. The
enforcement is structural, consistent with `ReferencePurpose` already excluding `'architecture'` (§20/BUILD
08): `PURPOSES_THAT_MAY_INFLUENCE_ARCHITECTURE` is a permanently empty array, and
`referenceCanInfluenceArchitecture()` always returns `false`. No override/authorization mechanism was added
in this amendment — "unless explicitly authorized" is intentionally left unimplemented rather than bolted on
as an easily-abused flag; a real authorization mechanism (e.g. a distinct Post-MVP "Creative View" mode) is a
separate, deliberate future decision.

### Camera & Lighting Intelligence (`camera-intelligence.ts`, `lighting-intelligence.ts`)
Structured wrappers around the existing `CameraDNA`/`LightingDNA` (BUILD 08) adding classification
(`classifyLens`, `classifyPerspective`) and the amendment's named lighting mood tags (clear light, sunlight
filtering through canopy leaves, dappled light, evocative shadows, cinematic lighting) plus a fixed
`DEFAULT_EXPOSURE_PROFILE` (medium exposure, controlled highlights, detailed shadows, clean blacks,
medium-to-high contrast, clear spatial layering) matching the amendment's baseline verbatim.
`preserveOriginalCamera` on `CameraIntelligence` implements "if SketchUp viewport + Camera Lock enabled,
preserve original camera." The illustrative camera system field (e.g. "ARRI Alexa Mini LF / Cooke Panchro")
is typed as optional/nullable — illustrative, never mandatory, matching the amendment's explicit caveat.

### Structural constraints (`packages/ai-core/src/structural-constraints.ts`)
`deriveStructuralConstraints({ architectureLockEnabled })` distinguishes two kinds of flags: geometric-fidelity
flags (`strictlyAdhereToReferenceSketch`, `preserveStructuralIntegrity`, `preserveExactGeometry`,
`exactLineArtTranslation`) relax to `false` when Architecture Lock is disabled, matching BUILD 08's
source-fidelity precedence; output-quality flags (`noHallucinatedDetails`, `photorealistic`) stay `true`
unconditionally — disabling Architecture Lock permits deviation from the sketch, it never permits
hallucinated or non-photorealistic output.

### User Visual Preference DNA (`packages/project-core/src/user-visual-preference-dna.ts`,
`packages/ai-core/src/user-preference-application.ts`)
`UserVisualPreferenceDNA` deliberately has **no architecture field** — architecture is never a user
preference, only a source-derived, lock-protected fact. `applyUserVisualPreference()` checks each of
style/camera/material/lighting against the corresponding lock's `.enabled` state before applying it: locked
fields are suppressed and reported in `suppressedFields` (never silently dropped, matching BUILD 08's
`ResolvedConflict` pattern), unlocked fields are applied and reported in `appliedFields`. Only this function
may mutate a `NormalizedRequest` with preference data — the amendment's "only explicit user
approvals/selections/configuration may update it" is enforced by there being no other write path into
`UserVisualPreferenceDNA`, and no field on it accepts free-form personal data (`otherPreferences` is a
`Record<string, string>` of explicit style/config key-value pairs the user typed, not an inference target).

### Prompt Inspector (`packages/prompt-engine/src/prompt-inspector.ts`)
`PROMPT_INSPECTOR_SECTION_KEYS` names all fourteen amendment-specified sections. `SECTION_LOCK` maps only the
five lock-governed sections (architecture/camera/material/style/lighting) to their `LockId`; every other
section is always editable. `applyPromptInspectorEdit()` throws a typed `DomainError` (`LOCK_PROTECTED_FIELD`)
on an edit to a locked section rather than silently ignoring or silently accepting it — matching the
amendment's "no lock may be silently ignored." Pure and immutable: returns a new `PromptInspectorState`,
never mutates the one passed in.

### UI wiring (minimal, per "do not redesign the entire UI")
`ProjectSessionState.language: LanguageConfig` (`apps/web/src/state/project-session.ts`), defaulting to
`DEFAULT_LANGUAGE_CONFIG`. `Header.tsx` gained a real VI | EN toggle (`aria-pressed` buttons, not a stub)
that updates `uiLanguage` through the existing `ProjectSessionStore`/`useProjectSessionActions` — the same
state system every other component already uses (BUILD 03 decision, §15). This wires the *architecture* for
a bilingual UI; translating existing UI copy string-by-string is out of scope for this amendment. "Dò prompt
từ ảnh" (`PromptFromImage.tsx`, BUILD 03) is unchanged and remains the first-class entry point.

### BUILD 09 / 10 / 11 boundary (restated for clarity; BUILD 10 is now complete — see §23)
- **BUILD 09** (§21, complete): scenario inputs only (`ScenarioBuilder`, `ScenarioSlots`).
- **BUILD 10** (§23, complete): Reference Intelligence — reference image + purpose →
  `ExtractedVisualLanguage` (`gemini-reference-engine.ts`'s `extract()`, real).
- **BUILD 11**: Master Prompt Compiler — structured intelligence + scenario + reference visual language +
  locks + user preference → real `CanonicalMasterPrompt`/`PromptOutput` (`compiler.ts`'s `compile()` still
  `NOT_IMPLEMENTED`). This amendment's `mapNormalizedRequestToPromptIntelligence()` and
  `buildCanonicalPromptDNA()` are real, tested pure functions, but nothing before BUILD 11 calls a model and
  produces a *generated* prompt from a real source image — that composition is BUILD 11's job.

## 23. BUILD 10 Reference Intelligence Implementation Record

Real Gemini-backed extraction, following the exact pattern BUILD 07 established for Vision Analysis —
same provider, same PROVIDER_NOT_CONFIGURED-without-a-key honesty, same "validated against docs, not
exercised live" caveat (CLAUDE.md rule 13) since no GEMINI_API_KEY was available at implementation time.

- **Real bug fixed in the BUILD 02 scaffolding**: `ReferenceIntelligence.extract(referenceAssetUrl: string,
  purpose)` took a bare URL the engine would have to fetch itself — an SSRF-shaped design, inconsistent with
  `VisionAnalysisEngine.analyze()`'s already-documented bytes-based `SourceAssetRef` pattern (BUILD 07).
  Corrected to `extract(referenceAsset: ReferenceAssetRef, purpose)` — the caller (apps/api) already has the
  bytes from `AssetStore.get()`, so the engine never fetches an arbitrary caller-supplied URL
  (`packages/ai-core/src/reference-intelligence.ts`).
- **`reference-field-vocabulary.ts`**: the single source of truth for which fields each `ReferencePurpose`
  may ever populate — structurally enforces CLAUDE.md rule 5 ("reference never transmits source
  architecture") at the data-shape level, not just in a prompt instruction. `filterFieldsForPurpose()` is
  applied to every model response as a second, non-bypassable filter — even a schema-valid response that
  somehow included an `architecture`/`geometry` key gets it stripped before an `ExtractedVisualLanguage` is
  ever constructed (`reference-field-vocabulary.test.ts` proves this against a deliberately "leaked" field).
  The `'camera'` purpose is deliberately scoped to photographic *character* only (`lensCharacteristic`,
  `framingStyle`, `depthOfFieldLook`) — never a position/FOV that could be mistaken for an override of the
  real, source-derived `CameraDNA` (Camera Lock's protected field).
- **`gemini-reference-engine.ts`**: `createGeminiReferenceIntelligenceEngine()`, mirroring
  `createGeminiVisionAnalysisEngine()`'s structure (request shape, `PROVIDER_NOT_CONFIGURED` short-circuit,
  error classification by HTTP status, response-schema validation) with a purpose-scoped prompt and
  JSON-schema that only ever request the allowed fields for the given purpose, plus an explicit
  "do NOT describe architecture/geometry" instruction as the model-facing layer of defense (the vocabulary
  filter above is the structural layer that doesn't depend on the model complying).
- **`ReferenceRecord`/`ReferenceRepository`** (`packages/project-core/src/repositories.ts`,
  `InMemoryReferenceRepository`): matches docs/04's "Reference" entity exactly (assetId, purpose,
  extractedVisualLanguage, extractedPrompt, weight, constraints). `extractedVisualLanguage` stays `unknown`
  for the same project-core/ai-core dependency-direction reason as `AnalysisRecord.structuredIntelligence`
  (docs/03 §3). `extractedPrompt` stays `null` — compiling a full prompt is BUILD 11's job, not this gate's;
  populating it here would move BUILD 11 functionality into BUILD 10 (the same boundary discipline as BUILD
  09 not doing BUILD 11's compilation).
- **`POST /projects/:id/references`** (`apps/api`): validates the project and asset exist, calls the engine,
  persists a `ReferenceRecord` (no `GenerationVersion` — docs/03 ADR-006 only versions Analysis/Generation
  events, not references), and returns the extraction. An explicit request `weight` overrides the engine's
  default (1) before persisting/returning — the Reference Mixer that would otherwise resolve/apply this
  weight (docs/08 "Reference Mixer": source architecture + selected reference attributes + scenario + locks
  → normalized visual specification) is out of scope for this gate, same boundary discipline as above.
- **Real UI wiring**: `ReferencePanel` (new) — a real reference-image upload (reusing `UploadDropzone`,
  which gained an optional `label`/`hint` override so two dropzones on one page have distinct accessible
  names) gated on a project already existing, a purpose `<select>` sourced from the same
  `REFERENCE_PURPOSES` vocabulary the server validates against, and a real "Extract visual language" call.
  "Dò prompt từ ảnh" (`PromptFromImage.tsx`, previously a structural-only stub since BUILD 03) is now real:
  it runs the same extraction with `purpose: 'auto'` against the reference image and displays the actual
  returned fields — never a fabricated "compiled prompt," since that compilation is still BUILD 11's job.
- **Verified live**: started the built `apps/api` server and the `apps/web` dev server; the app renders the
  new Reference section with the correct disabled-until-project-exists state and hint text. Browser-based
  file upload could not be exercised (the sandbox only allows uploading files the user has explicitly
  shared with the session — a tooling constraint, not a code defect), so the full request path was verified
  directly against the live server instead: created a real project, uploaded a real asset, then called
  `POST /projects/:id/references` and confirmed the real, honest `503 PROVIDER_NOT_CONFIGURED` (no
  GEMINI_API_KEY set, matching BUILD 07's verified analysis behavior), a real `400 VALIDATION_ERROR` for an
  out-of-vocabulary purpose (`"architecture"` rejected at the schema boundary, never reaching the provider),
  and a real `404 PROJECT_NOT_FOUND` for an unknown project — all against the actual running server, not a
  test double.

## 24. BUILD 11 Master Prompt Compiler Implementation Record

Pure domain logic — like BUILD 09's Scenario Builder and BUILD 08's Reasoning Engine, `PromptCompiler.compile()`
and the new orchestration layer have no I/O and are called directly client-side, no `apps/api` endpoint needed
(prompt-engine has zero I/O dependencies by design, docs/03 §3). This is also the gate that first wires the
Reasoning Engine (BUILD 08) into the app at all — `reasoningEngine.resolve()` was real since BUILD 08 but never
called by `apps/api` or `apps/web` until now.

- **`compiler.ts`**: `PromptCompiler.compile()` is now real — deterministic string composition of all 14
  docs/09 `MasterPromptSections` from an already-resolved `NormalizedRequest`. No provider call: every input is
  already real structured data (Structured Intelligence is the source of truth, CLAUDE.md rule 1), so this only
  formats it, never invents content. Module-conditional: the `architecture` section is composed from
  `architectureDNA` for the architecture module and from `interiorDNA` for the interior module (matching BUILD
  08's `deriveProjectDNA` split) — never left empty. The `camera` section notes "Camera Lock enabled — preserve
  the original camera exactly" only when Camera Lock is actually enabled; `constraints` reflects
  `deriveStructuralConstraints()` exactly (geometric-fidelity phrases drop when Architecture Lock is disabled,
  output-quality phrases never do) — the same lock precedence already established, now visible in the compiled
  text itself, not just internal booleans.
- **Real bug fixed**: none carried into this gate, but a design question resolved deliberately — `masterPromptEn`/
  `masterPromptVi` (deliverables B/C) are the SAME canonical content as `canonicalPromptDNA.completeCopyPastePrompt`,
  one per language, not the full verbose 14-section breakdown — keeping B/C and the "Complete copy/paste Prompt"
  consistent with each other (the amendment's Canonical Prompt DNA structure) while the full docs/09 internal
  form stays available via `compiled` for a future Model Adapter that wants per-field detail.
- **`vi-glossary.ts`** (new): real, bounded Vietnamese translation for the app's own closed vocabularies —
  docs/07 scenario terms, lighting mood tags (§22), camera lens/perspective classification (§22), and a small
  fixed set of structural-constraint/style phrases. `translateKnownTerm()` returns `null` (never a guess) for
  anything outside that vocabulary — CLAUDE.md rule 7 "never fake a production integration": this is not a
  general-purpose translator and never claims to be one. Freeform text (a Vision Analysis description sentence)
  is never routed through it; that stays the amendment's existing honest mirror-with-warning behavior
  (`mirrorAsPromptFieldValue`, prompt-intelligence.ts) — real full-text translation is a distinct, later
  capability, intentionally not invented here.
- **`prompt-output-compiler.ts`** (new): `compilePromptOutput()` — the orchestration the amendment deferred to
  this gate. Calls `promptCompiler.compile()`, `mapNormalizedRequestToPromptIntelligence()`, and builds the
  eight `CanonicalPromptDNA` sections bilingually, using `vi-glossary.ts` for known-vocabulary terms (style,
  lighting time-of-day, camera lens/perspective, structural-constraint phrases) and the same honest mirroring
  for freeform fragments (subject description, material/object labels). `assertConciseKeywordStyle()`
  (canonical-prompt-dna.ts) is a real, enforced gate here, not just documentation — the initial Vietnamese
  constraint phrases were too wordy (45 words, over the 40-word ceiling) and were shortened to genuinely
  concise/keyword-oriented phrasing, caught by the test suite, not discovered later.
- **UI wiring**: `PromptEditor` gained an optional `onCompile`/`canCompile`/`compileStatus`/`compileError` prop
  set — omitted entirely (pre-BUILD-11 behavior preserved) when a caller doesn't pass `onCompile`. `ControlPanel`
  wires a real "Compile Prompt" action: enabled once analysis (`structuredIntelligence`+`locks`) and an applied
  `scenario` both exist, it calls `reasoningEngine.resolve()` then `compilePromptOutput()` (no network call,
  matching `scenarioBuilder.normalize()`'s pattern) and writes the resolved-language copy/paste prompt into
  `ProjectSessionState.promptDraft` — the user can still hand-edit afterward, same textarea as before. The full
  `PromptOutput` (bilingual master prompts, `CanonicalPromptDNA`, `PromptIntelligence`) is kept in the new
  `ProjectSessionState.promptOutput` field for future consumers (e.g. a Prompt Inspector UI — still not built;
  see below).
- **Verified live**: rebuilt and started `apps/api`/`apps/web`; confirmed the new "Compile Prompt" button
  renders correctly (disabled pre-analysis) alongside Clear/Copy. The full upload → analyze → apply scenario →
  compile flow is exercised end-to-end in `ControlPanel.test.tsx` with only the two network calls mocked
  (project create, asset upload, analysis) — `reasoningEngine.resolve()` and `compilePromptOutput()` run for
  real, unmocked, and the test asserts real compiled bilingual text lands in the Prompt Editor textarea; this
  is stronger evidence than a manual click-through would add, since it exercises the exact production code path.
- **Explicitly out of scope** (documented, not silently skipped): a full Prompt Inspector UI (14 lock-aware,
  editable sections — the amendment's contract from §22 exists; no UI consumes it yet) and the "Reference
  Mixer" (§23) remain future work. `apps/api` gains no new route in this gate — see above.

## 25. BUILD 12 Model Adapter Layer Implementation Record

Two of the three declared render-core adapters (docs/07 vocabulary: Nano Banana, Google Flow, ChatGPT Image)
are now real. `apps/api` gains no new route in this gate — no caller wires a generation request yet
(BUILD 13's job); this gate is the adapter layer itself, matching docs/10's interface exactly.

- **`nano-banana-adapter.ts`** (new): `createNanoBananaAdapter()`, real Gemini Interactions API image
  generation, validated against current docs (accessed 2026-09-04):
  https://ai.google.dev/gemini-api/docs/interactions/image-generation. Same endpoint already used by Vision
  Analysis (BUILD 07) and Reference Intelligence (BUILD 10), with `response_format.type: "image"` instead of
  a JSON schema. Fetches each `sourceAssetUrls`/`referenceAssetUrls` entry into bytes (via the same injectable
  `fetchFn` DI pattern as `gemini-vision-engine.ts`) before building the multimodal request — genuinely
  edit-like since image+text input in one call is native to this model family (`capabilities().supportsEdit:
  true`, honestly, not just copied from a template). `PROVIDER_NOT_CONFIGURED` without `NANO_BANANA_API_KEY`,
  matching the BUILD 07/10 pattern exactly. **Unverified against the real API** — no key was available at
  implementation time (CLAUDE.md rule 13 caveat, same as every other Gemini integration in this project).
- **`chatgpt-image-adapter.ts`** (new): `createChatGPTImageAdapter()`, real OpenAI Images API
  (`gpt-image-1`), validated against current docs (accessed 2026-09-04):
  https://developers.openai.com/api/docs/guides/image-generation. Deliberately never sends
  `response_format` — confirmed that gpt-image-1+ models don't support it and always return `b64_json`
  (unlike dall-e-2/3); sending it would be sending a parameter the real API doesn't accept, which is exactly
  the kind of assumption rule 13 exists to catch before, not after, shipping. `mapAspectRatioToSize()` /
  `mapResolutionToQuality()` translate the app's own docs/07 vocabulary into `gpt-image-1`'s actual size/
  quality enums — a real per-provider mapping, not an assumed 1:1 correspondence. `supportsEdit: false`,
  honestly: a real edit call needs OpenAI's separate `/images/edits` endpoint, not implemented here.
- **Real, documented research finding — Google Flow has no official public API**: before implementing
  `GoogleFlowAdapter.generate()`, verified (CLAUDE.md rule 13) whether Google publishes an official REST API
  for Google Flow itself. It does not, as of this implementation (2026-09-04) — Flow is a consumer creative
  app; its image generation is powered by Nano Banana Pro (the same model family `NanoBananaAdapter` already
  calls for real) and its video generation by Veo (Vertex AI), neither of which is "the Google Flow API." The
  only "Google Flow API" found is an unofficial third-party wrapper (useapi.net) that automates a user's own
  Flow account via session/reCAPTCHA automation, not an official API key — and Google's own developer forum
  has an open, unanswered thread asking for exactly this. Implementing against that unofficial wrapper and
  presenting it as a real integration would violate CLAUDE.md rule 7. `GoogleFlowAdapter.generate()` stays
  `NOT_IMPLEMENTED`, with this finding recorded in `provider-adapters.ts` and its error message — a documented
  decision, not a silently-deferred stub.
- **`GenerationRequest.sourceAssetUrls`/`referenceAssetUrls` stayed URL-based** (BUILD 02 scaffolding),
  deliberately not redesigned to bytes here the way `ReferenceIntelligence.extract()` was in BUILD 10: unlike
  that case, this gate has no real caller yet to establish actual URL provenance (internal `AssetStore` URL vs.
  arbitrary external input), and redesigning the canonical `GenerationRequest` contract before BUILD 13 (its
  first real consumer) exists would be premature. Each adapter fetches the URLs itself via its injectable
  `fetchFn`. Flagged here for BUILD 13 to revisit with real provenance information, not silently decided.
- **Output handling**: docs/10 "output asset registration" is `apps/api`'s job once a real generation endpoint
  exists (BUILD 13) — `model-adapters` has no storage dependency (docs/03 §3 dependency direction) and cannot
  persist an image itself. Both real adapters return the actual provider output as a `data:` URI in
  `outputAssetUrls` — real, immediately decodable bytes, not a placeholder string like `FutureAdapter`'s
  `memory://` scheme.
- **Verified live**: built the package and ran both real adapters plus `GoogleFlowAdapter` outside the test
  harness with no API keys configured, through the actual `ImageGenerationService.resolve()` path — confirmed
  real `PROVIDER_NOT_CONFIGURED` for Nano Banana/ChatGPT Image and the documented `NOT_IMPLEMENTED` finding
  for Google Flow, matching the automated test expectations exactly.

## 26. BUILD 13 Image Generation Pipeline Implementation Record

docs/11 steps 1-9 (validate, freeze job/version, compile, adapt, submit, track status, store outputs, store
provenance); steps 10-11 (QC, correction/regeneration) stay BUILD 17's job — `aiQc.evaluate()` is untouched.

- **Real, load-bearing bug fixed in `GenerationRequest` before it shipped**: BUILD 12's `sourceAssetUrls`/
  `referenceAssetUrls: string[]` turned out unusable the moment a real caller existed — `apps/api` only ever
  has *relative* `/assets/:id` paths (Node's `fetch()` can't resolve those without a base URL), and the route
  already has the bytes from `AssetStore.get()` anyway, so having the adapter re-fetch them would also be a
  wasteful, awkward self-referential HTTP loopback. Corrected to `sourceAssets`/`referenceAssets:
  GenerationAssetRef[]` (real bytes) — the same rationale already established for `SourceAssetRef` (BUILD 07)
  and `ReferenceAssetRef` (BUILD 10), now applied a third time. `NanoBananaAdapter` simplified accordingly
  (base64-encodes the bytes it's handed directly — no `fetchFn` call for input assets at all anymore, only for
  the actual provider request). This is exactly the kind of thing BUILD 12's own docs flagged as open
  ("flagged here for BUILD 13 to revisit with real provenance information") — revisited here with the real
  information a real caller provides, not deferred again.
- **`JobQueue` gained `updateStatus()`** (`apps/api/src/job-queue.ts`) — BUILD 13 is this interface's first
  real caller, and docs/11 step 7 "Track status" requires actually moving a job past `'queued'`, which the
  BUILD 02 scaffolding never supported. `InMemoryJobQueue` still isn't a production queue (docs/03 §13,
  ADR-004 — concrete engine remains deferred); this only makes the existing dev/bootstrap reference
  implementation capable of the one thing docs/11 requires of it.
- **`POST /projects/:id/generations`** (`apps/api/src/routes.ts`, `handleRunGeneration`): validates the
  project, source asset, and every reference asset belong to the project; maps the docs/07 render-core
  vocabulary (`'Nano Banana'` etc.) to `RenderCoreSelection`; resolves the adapter via
  `ImageGenerationService.resolve()`; runs `adapter.validate()` before ever calling `generate()`; enqueues a
  real job (`requestId` as idempotency key) and tracks `running` → `succeeded`/`failed`; decodes each real
  `data:` URI the adapter returns back into bytes and registers them as real `AssetStore` assets — the
  "output asset registration" BUILD 12 explicitly deferred to this gate; persists a `GenerationRecord` and a
  `kind: 'generation'` `GenerationVersion`, advancing `Project.currentVersionId` (docs/03 ADR-006, same
  append-only-DAG pattern as the analysis route). Does **not** re-derive the compiled prompt server-side —
  `promptText` arrives already compiled (BUILD 11's `compilePromptOutput`, pure/no-I/O, already ran
  client-side) — matching the established "pure domain logic runs where it's needed, no network round-trip
  for its own sake" pattern (BUILD 09/11).
- **`'Auto'` render-core resolution is deliberate, not incidental**: adapters are registered `nano-banana`
  first in `app-context.ts` specifically so `ImageGenerationService.resolve('auto')` (which picks the first
  registered adapter) resolves to a real, working adapter rather than the still-`NOT_IMPLEMENTED`
  `google-flow` — documented in the config's own comment, not left to insertion-order coincidence.
  Real bug fixed in the process: `HTTP_STATUS_BY_CODE` (error-handling.ts) had no entries for
  `NANO_BANANA_PROVIDER_ERROR`/`CHATGPT_IMAGE_PROVIDER_ERROR`/`UNKNOWN_RENDER_CORE`/`NO_ADAPTERS_REGISTERED`/
  `JOB_NOT_FOUND` — would have fallen through to a generic 400 — added, matching the existing
  `VISION_PROVIDER_ERROR`/`REFERENCE_PROVIDER_ERROR` → 502 convention.
- **UI wiring**: `ModuleWorkspace` (previously a static shell around an always-`disabled` `PrimaryAction`)
  now owns the real Render action — enabled once a source image, an applied scenario (for aspect ratio/
  resolution/render core), and non-empty prompt text all exist. `promptVersion` falls back to `'manual-edit'`
  honestly when the prompt was hand-typed rather than compiled (CLAUDE.md rule 14 "when available" — there is
  no real compiler version to report for text that was never compiled). `Canvas` gained `outputImageUrl`,
  taking priority over `sourceImageUrl` once a generation succeeds — the actual "photograph" the product's
  own tagline ("viewport → photograph") promises, not just the uploaded sketch.
- **Verified live**: rebuilt and started `apps/api`/`apps/web`; confirmed the Render bar's hint text is real
  (no longer the stale BUILD 12 placeholder) and correctly disabled pre-readiness. Ran the full pipeline live
  against the actual running server (not a test double): created a real project, uploaded a real asset, then
  called `POST /projects/:id/generations` for both `'Nano Banana'` (real `503 PROVIDER_NOT_CONFIGURED`, no
  key set) and `'Google Flow'` (real `501 NOT_IMPLEMENTED`, the BUILD 12 finding) — both matching the
  automated test expectations exactly.
- **Explicitly out of scope** (documented, not silently skipped): QC/regeneration (docs/11 steps 10-11,
  BUILD 17); a real async job-processing engine (still deferred, docs/03 §13/ADR-004 — this gate only makes
  the existing interface's status-tracking capability real, not the underlying execution model); populating
  `ProjectSessionState.generationHistory` (still always empty — would need a `GET /projects/:id/versions`
  listing endpoint that doesn't exist yet, a pre-existing gap since BUILD 02, not introduced here).

## 27. BUILD 14 Advanced Image Editor Implementation Record

docs/12's five required per-edit declarations (target region, intended change, protected regions/locks,
parent generation, resulting asset) map 1:1 onto `EditRecord` (packages/project-core/src/repositories.ts).
Real for the two providers BUILD 12 made real; still `NOT_IMPLEMENTED` for Google Flow, same as generation.

- **`ImageGenerationAdapter.edit()`** (new, optional method — `adapter.ts`): present only when
  `capabilities().supportsEdit` is true, so a caller can never accidentally invoke a fake/no-op edit; the
  route checks `adapter.edit` directly and throws a typed `EDIT_NOT_SUPPORTED` (501) rather than silently
  falling back to `generate()`.
- **`ChatGPTImageAdapter.edit()`**: real `POST /images/edits`, validated against current official
  documentation (accessed 2026-09-04) — genuinely different from `generate()`: multipart/form-data, not
  JSON (no `content-type` header set manually — `fetch` computes the multipart boundary itself from the
  `FormData` body), with a real optional mask (PNG, fully-transparent = editable region, matching OpenAI's
  own mask semantics exactly). `capabilities().supportsEdit` flips from `false` (BUILD 12, "not implemented
  here") to `true` now that it actually is. A community-reported issue (openai-node#1844, 2026-04) noted the
  edits endpoint rejecting GPT Image models in some configurations — recorded in the adapter's own doc
  comment as a live-behavior risk to re-check, per the same "validated against docs, not exercised against
  the real API" honesty already applied to every other Gemini/OpenAI integration in this project.
- **`NanoBananaAdapter.edit()`**: real, but honestly less capable than ChatGPT Image's — Gemini's
  Interactions API has no documented alpha-mask input, so a supplied mask is passed as an additional image
  with an explicit textual instruction to treat it as the target region, not real pixel-level compositing.
  `supportsEdit` was already `true` since BUILD 12 (multimodal image+text input is inherently edit-like for
  this model); this gate is what actually implements the method the capability flag promised.
- **`EDIT_CATEGORIES`** (new, `packages/project-core/src/edit-vocabulary.ts`): a closed vocabulary mirroring
  docs/12's capability list, structured purely for UI selection and provenance — the category never changes
  which adapter method is called; the real edit instruction is always the freeform `intendedChange` text.
  "Select / Mask / Brush" (docs/12) is a UI *tool*, deliberately not listed as a category.
- **`POST /projects/:id/generations/:generationId/edits`** (`apps/api/src/routes.ts`,
  `handleRunEdit`): validates the parent generation exists and belongs to the project, resolves the adapter
  via `parentGeneration.provider` (never a different provider mid-stream — editing with a different model
  than the one that produced the image would give it no real understanding of what it's looking at),
  composes the edit instruction from the real declared target region + intended change + protected locks,
  runs the same job-tracking/output-registration/provenance pattern BUILD 13 established, and creates a
  `kind: 'edit'` `GenerationVersion` (docs/04 already scaffolded this `kind` value at BUILD 02 — never used
  until now). "Protected regions/locks" is the REAL current lock state (`state.locks`, client-submitted,
  since locks are never persisted server-side — the same pattern as `promptVersion`/`scenarioVersion` in
  BUILD 13), never fabricated.
- **UI wiring**: `EditPanel` (new) — category `<select>`, target region text input, intended change
  textarea, "Apply Edit." Enabled once `latestGenerationId`/`latestOutputAssetId` exist (BUILD 13's Render
  populates them; a successful edit updates them too, so a second edit works from the first edit's result).
  `ProjectSessionState` gained `latestGenerationId` (always the original generation, for provenance) and
  `latestOutputAssetId` (the actual current image bytes to edit next — generation or a prior edit). The
  Advanced Editor genuinely extends the flow after Render (docs/02 updated — Render stays the prominent
  generation trigger, no longer the literal last DOM element).
- **Explicitly out of scope, deliberately** (docs/12 lists these; not silently faked): freehand select/mask/
  brush canvas UI — "target region" is real, structured, declared input, but text-described rather than a
  drawn pixel mask; the `maskAsset`/`maskAssetId` plumbing is real end-to-end (both adapters, the route, the
  schema) ahead of that UI, tested directly rather than left unreachable. Inpaint/outpaint, material
  replacement, furniture/object replacement, people/vegetation/vehicles/decor/environment, and lighting/
  atmosphere edits are all real via `EDIT_CATEGORIES` + freeform `intendedChange` — none needed
  category-specific server logic.
- **Verified live**: rebuilt and started `apps/api`/`apps/web`; confirmed the Edit panel renders the correct
  empty state pre-render ("No generated image yet — Render an image first, then edit the result here").
  Called the real running server directly: `POST .../edits` against an unknown generation (real `404
  GENERATION_NOT_FOUND`) and with an invalid category (validated after the generation-existence check, same
  ordering as the automated tests) — matching the 8-test `edit-route.test.ts` suite exactly.

## 28. BUILD 15 Multi-View / Sync / Creative View Implementation Record

docs/13's three requirements, all real: Sync View (change camera, preserve everything else + locked
attributes), Creative View (alternative camera/composition, preserve only Architecture DNA), and the version
tree (every view linked to its parent version and project snapshot — `GenerationVersion.kind: 'view'` and
`GenerationRecord.viewId`, both scaffolded since BUILD 02, populated for the first time here).

- **`resolveView()`** (new, `packages/ai-core/src/view.ts`) — deliberately NOT a change to
  `reasoning-engine.ts`'s tested lock-precedence behavior (BUILD 08): a View takes an ALREADY-RESOLVED
  `NormalizedRequest` (the same one BUILD 11's compiler already snapshots into
  `CanonicalMasterPrompt.normalizedRequestSnapshot`) and derives a second, request-scoped variant from it —
  zero regression risk to the reasoning engine's own test suite. Sync View structurally ignores any material/
  lighting/style proposal it receives (recorded as a `warning`-severity conflict — docs/06's "never override
  explicit locks... without recording it" pattern, applied to a View for the first time); Creative View may
  change camera/material/lighting/style, but `ViewProposal` has no field for architecture at all — the same
  "no field to abuse" pattern already used for `source-reference-separation.ts`'s architecture protection
  (Architecture Amendment) — so architecture DNA cannot be overridden even by a bug, only by a type change.
  A real, subtle correctness fix included: the returned request's `locks` array has the affected lock(s)
  marked `enabled: false` (an ephemeral, request-scoped snapshot only — never a real attributed change to the
  project's persisted `Lock`) so `compiler.ts`'s `compileCamera()` doesn't emit the self-contradictory "Camera
  Lock enabled — preserve the original camera exactly" right next to a compiled prompt describing a
  deliberately different target camera.
- **`ViewRecord`** (new, `packages/project-core/src/repositories.ts`) — unlike `AnalysisRecord`/
  `ReferenceRecord`, the proposal fields are typed precisely as `Partial<CameraDNA>`/`Partial<MaterialDNA>`/
  `Partial<LightingDNA>`, not `unknown` — those types already live in project-core (dna.ts), so no ai-core
  dependency-direction issue applies. `ignoredProposals` records what a Sync View structurally refused to
  apply — real provenance, not silent.
- **`POST /projects/:id/views`** (`apps/api/src/routes.ts`, `handleRunView`) — shares a new
  `submitGeneration()` helper with `/generations` (extracted from `handleRunGeneration` during this gate,
  zero behavior change, verified by the full existing `generation-route.test.ts` suite passing unmodified)
  for the actual provider call/job-tracking/output-registration, differing only in what it persists
  afterward: a `ViewRecord`, `GenerationRecord.viewId` set to it, and `kind: 'view'` instead of
  `kind: 'generation'`. Like `/generations`, does not re-resolve `resolveView()` or re-compile the prompt
  server-side — both are pure/no-I/O and already ran client-side; the client submits the already-compiled
  prompt plus the real proposal fields for provenance.
- **UI wiring**: `MultiViewPanel` (new) — mode select (Sync/Creative), camera height/lens/perspective (both
  modes), style (Creative only). Requires a compiled prompt (`state.promptOutput`, BUILD 11) to have a base
  `NormalizedRequest` to resolve a view from. Material/lighting proposals are real end-to-end (the domain
  function, the schema, the route) but not exposed in this UI — the same "real capability, partial UI"
  pattern already used for the Advanced Editor's mask support (BUILD 14).
- **Verified live**: rebuilt and started `apps/api`/`apps/web`; confirmed the Multi-View panel's honest empty
  state ("No compiled prompt yet"). Called the real running server directly: `POST .../views` with no
  provider key (real `503 PROVIDER_NOT_CONFIGURED`) and an invalid mode (real `400 VALIDATION_ERROR`) —
  matching the 7-test `view-route.test.ts` suite exactly.
- **Explicitly out of scope** (documented, not silently skipped): material/lighting proposal UI (real domain
  support, no UI control yet); chaining a View's output into a further Edit was verified structurally
  possible (a View's result populates `latestGenerationId`/`latestOutputAssetId` exactly like a normal
  Render) but not separately re-tested end-to-end across both gates in one flow.

## 29. BUILD 16 Image → Video Implementation Record

docs/14's "Input: final image + Project DNA + motion plan," 11 motion types, and 5 video locks
(architecture/camera/objects/materials/temporal-consistency), all real. The first gate needing a genuinely
asynchronous provider contract (docs/11 "long-running operations must be asynchronous," taken literally for
the first time — BUILD 13-15's image/edit/view routes all resolved synchronously within one HTTP request as a
deliberate, documented scoping choice).

- **`VideoGenerationAdapter`** (new, `packages/model-adapters/src/video-adapter.ts`) — deliberately NOT a
  variant of `ImageGenerationAdapter`: `submit()` returns a `VideoOperationRef` immediately, and a separate
  `pollStatus()` observes completion later, matching Veo's real `predictLongRunning` submit-then-poll shape.
  A new `VideoGenerationService`/`VideoRenderCoreSelection` (`'veo' | 'sora' | 'auto'`) mirrors
  `ImageGenerationService`'s resolve-by-selection pattern without reusing its types.
- **`VeoAdapter`** (new, `veo-adapter.ts`) — real, full implementation against Google's Veo API
  (`generativelanguage.googleapis.com/v1beta/models/{model}:predictLongRunning` to submit,
  `GET .../{operationName}` to poll), validated against current provider documentation (CLAUDE.md rule 13);
  no `VEO_API_KEY` was available at implementation time, so it has not been exercised against the real API —
  same caveat as every prior adapter. Duration is clamped to Veo's supported {4, 6, 8}s; aspect ratio to
  {16:9, 9:16}; resolution mapped to {720p, 1080p, 4k}. A succeeded poll downloads the actual generated video
  bytes (same API key) and returns a real, decodable `data:video/mp4;base64,...` URI — never a placeholder.
- **`SoraAdapter`** (new, `sora-adapter.ts`) — stays `NOT_IMPLEMENTED`, same disciplined pattern as BUILD 12's
  Google Flow finding: research first, document the finding, never silently fake it (CLAUDE.md rule 7).
  Real finding: OpenAI's own documentation states the Sora 2 Videos API is deprecated and shutting down
  **2026-09-24** — implementing against it now would not be a durable integration. The exact date is in both
  the code comment and the thrown error message.
- **`VideoRecord`/`VideoRepository`** (new, `packages/project-core/src/repositories.ts`,
  `packages/storage-adapters/src/in-memory.ts`) — `protectedLocks` is always the full `VIDEO_LOCK_IDS` set
  (`video-vocabulary.ts`), not a per-request user choice: unlike the 5 image Locks, docs/14 never frames video
  locks as user-toggleable — they read as fixed guarantees a video generation always maintains. `VideoLockId`
  is a deliberately separate closed-vocabulary type from `LockId` — the two sets only partially overlap
  (architecture/camera/materials conceptually; "objects" and "temporal-consistency" have no image-Lock
  equivalent). `GenerationVersionKind` gained a `'video'` member (`version.ts`) so every video submission is
  linked into the version tree the same way analysis/generation/edit/view already are (ADR-006).
  `providerOperationName`/`status` track the real async lifecycle; `VideoRepository.update()` is a new
  full-record-replace method (`InMemoryEditRepository`/`InMemoryViewRepository` never needed one, since edits/
  views resolve synchronously).
- **`POST /projects/:id/generations/:generationId/videos`** (`handleRunVideo`) — submits to the real adapter
  and returns **202** with `video.status === 'running'` immediately; does not block on completion. **`GET
  /projects/:id/videos/:videoId`** (`handleGetVideoStatus`, new route shape — the first GET-based
  status-poll endpoint in this codebase) — a video already `succeeded`/`failed` is returned as-is without
  re-polling the provider or re-downloading output; a `running` video calls `adapter.pollStatus()` for real,
  and on `succeeded` decodes the returned `data:` URI, stores it via the same `assetStore.put()`/
  `decodeDataUri()` mechanism BUILD 12/13 established for images, and persists the terminal state.
- **UI wiring**: `VideoPanel` (new) — motion type select (`VIDEO_MOTION_TYPES`), motion description, duration,
  render core select, "Generate Video" button. The first UI component in this codebase needing real async
  polling rather than a single request/response round trip: `handleGenerateVideo` submits and immediately
  shows "Video generation in progress," then a recursive `setTimeout` calls `getVideoStatus()` every 3s until
  the provider reports `succeeded` (renders a real playable `<video>` from the stored asset URL) or `failed`
  (shown as a retryable error) — cleaned up on unmount. Video state (`videoId`/status/output URL) is kept
  local to the panel, not in `ProjectSessionState` — the async lifecycle doesn't fit the store's
  request/response-shaped fields the way `latestGenerationOutputUrls` does for synchronous routes.
- **Verified live**: 65/65 `apps/api` tests pass (10 new in `video-route.test.ts`, covering the full real
  submit→poll(running)→poll(succeeded)→real-output-asset flow with a scripted fake adapter, plus 404s,
  validation errors, `503 PROVIDER_NOT_CONFIGURED` for Veo with no key, and `501 NOT_IMPLEMENTED` for Sora
  with the deprecation message). Rebuilt and started `apps/api` for real; called it directly over HTTP:
  unknown project/generation/video all return the correct `404` envelopes. Rebuilt and started `apps/web`;
  confirmed in-browser the Video panel renders below Edit with its real honest empty state ("No generated
  image yet — Render an image first, then turn it into a video here").
- **Explicitly out of scope** (documented, not silently skipped): no real `VEO_API_KEY` exists to exercise the
  live Veo API end-to-end; Sora stays unimplemented per the deprecation finding above; no drawn/visual motion
  path editor (motion is text-described, matching the Advanced Editor's text-described target-region
  precedent from BUILD 14); video output is not chained into a further Edit/View (docs/14 doesn't describe
  video as an input to another generation step).

## 30. BUILD 17 AI QC / Auto-Regeneration Implementation Record

docs/15's VERIFY stage, real for the first time: `aiQc.evaluate()` (`packages/ai-core/src/qc.ts`) had been a
`NOT_IMPLEMENTED` contract stub since BUILD 02/16 — this gate implements it and wires the VERIFY→CREATE loop
docs/03 §4 step 5 describes.

- **Real gap found and closed before implementation**: docs/03 §5's `NormalizedRequest` (the Reasoning
  Engine's output) is computed entirely client-side (`ControlPanel.tsx`'s `reasoningEngine.resolve()`) and was
  discarded after prompt compilation — never persisted, never sent to `apps/api`. QC's own contract needs to
  compare against exactly that "expected structured intent." Rather than re-plumbing the entire
  `NormalizedRequest` tree across the wire (duplicating zod schemas for the 12-layer analysis, `Lock[]`,
  `NormalizedScenario`, etc. — disproportionate, and would duplicate business rules already enforced
  elsewhere, CLAUDE.md rule 9): `structuredIntelligence` is looked up server-side from the already-persisted,
  already-validated `AnalysisRecord` (BUILD 07) via a client-supplied `analysisId` (the API already returned
  this at analysis time; the client just wasn't keeping it — now it does, `ProjectSessionState.analysisId`).
  `ProjectDNA` is re-derived server-side from that via the existing pure `deriveProjectDNA()` (BUILD 08) — no
  duplication. Only `locks` (as minimal `{id, enabled}` pairs, not the full audit-trail `Lock` shape) crosses
  the wire with real per-field validation, since "which attributes must be preserved" is the one piece
  genuinely safety-critical to QC (CLAUDE.md rules 2-4) and not derivable from anything already server-side.
- **`AiQc.evaluate()` contract corrected before implementation** (`packages/ai-core/src/qc.ts`): docs/03 §5's
  representative signature (`sourceAssetUrl`/`outputAssetUrl: string`) would hit the exact problem BUILD 13
  already found and fixed for `GenerationRequest` — `apps/api` only ever has relative `/assets/:id` paths, not
  fetchable absolute URLs. Corrected to real bytes (`QcAssetRef { data, contentType }`), same reasoning as
  `SourceAssetRef`/`ReferenceAssetRef`/`GenerationAssetRef`. `normalizedRequest` is typed as a new, narrower
  `QcNormalizedRequestContext` (structuredIntelligence/projectDNA/enabledLocks/resolvedStyle/instructions) —
  not the full `NormalizedRequest` — since `scenario`/`references`/`conflicts` steer prompt COMPILATION
  (BUILD 09/11) but add nothing docs/15's 6 scores need to verify.
- **`createGeminiQcEngine()`** (new, `packages/ai-core/src/gemini-qc-engine.ts`) — same provider/API shape as
  BUILD 07/10's Gemini engines (Interactions API, validated against current docs, unverified live — no
  `GEMINI_API_KEY` available at implementation time, same caveat as every prior Gemini integration), extended
  to a two-image request (source + output) plus the expected-intent context serialized into the prompt.
  `computeQcDecision()` is deterministic, never trusts the model's own opinion of pass/fail (same philosophy
  as BUILD 07's "the zod schema is the actual enforcement point," not the model's own claim): a score below
  `QC_SCORE_THRESHOLD` (0.7 — a product decision made at implementation time, docs/15 names no concrete
  number, flagged for future tuning) only fails the attributes whose Lock is enabled (architecture/camera/
  material/lighting); `objectConsistencyScore`/`photorealismScore` have no corresponding Lock in the 5-lock
  model, so they're always enforced. `correctionInstruction` is drafted by the model but only ever surfaced
  on a real `fail`; a fallback is synthesized from the issues list if the model omits one on a fail.
- **`POST /projects/:id/generations/:id/qc`** (`handleRunQc`, `apps/api/src/routes.ts`) — loads the
  `GenerationRecord` + the `AnalysisRecord` named by the client's `analysisId`, resolves real source/output
  asset bytes, derives `ProjectDNA`, and calls the real engine. **`POST
  /projects/:id/generations/:id/regenerate`** (`handleRegenerate`) — reuses `submitGeneration()`, the exact
  same CREATE-stage helper `/generations` already uses (no duplicated business rules): the correction itself
  was already folded into the client's re-resolved Reasoning Engine `instructions` and recompiled prompt
  (the same "client owns Reasoning Engine + Prompt Compiler" pattern as every other render); this route's own
  job is only submitting it again and recording *why*, for provenance (CLAUDE.md rule 14) —
  `correctionInstruction` and `regeneratedFromGenerationId` land in the new `GenerationRecord.usageMetadata`.
  Neither route changes `GenerationRecord`'s shape or touches the existing `/generations`/`/edits`/`/views`/
  `/videos` routes.
- **UI wiring**: `QCPanel` (new) — "Run QC" (enabled once a generation, its source analysis, and the real
  5-lock set all exist), showing a PASS/FAIL badge, all 6 scores, and any issues; "Regenerate" appears only on
  a real `fail` and only once a `correctionInstruction` exists. A new shared helper,
  `apps/web/src/prompt-compilation.ts`'s `compileNormalizedPrompt()`, factors the Reasoning Engine →
  Prompt Compiler step out of `ControlPanel`'s Compile Prompt action so Regenerate can fold the correction
  into `instructions` and run the exact same real resolution, not a second copy of it (CLAUDE.md rule 9).
  `ProjectSessionState` gained `analysisId` (previously returned by the analysis route but discarded) and
  `normalizedRequest` (previously discarded after compiling) — both needed by QC, neither invented.
- **Dead code removed**: `packages/ai-core/src/not-implemented.ts` and `contracts.test.ts` — `qc.ts` was the
  last real caller of the `notImplemented()` stub-tracking helper; with QC implemented for real, both were
  unused weight, not a "future gate" placeholder anymore.
- **Verified live**: rebuilt and started `apps/api`; called the new routes directly over HTTP — unknown
  project and unknown generation both return the correct `404` envelopes (`PROJECT_NOT_FOUND`/
  `GENERATION_NOT_FOUND`) on both `/qc` and `/regenerate`, matching the automated test expectations exactly.
  The full real chain (create → upload → analysis → generation → QC → regenerate, with a scripted fake QC
  engine and adapter) is exercised end-to-end by `apps/api/src/generation-qc-route.test.ts` against the real
  HTTP server. No `GEMINI_API_KEY` exists to exercise the real Gemini QC call end-to-end — same caveat as
  every other Gemini integration in this project.
- **Explicitly out of scope** (documented, not silently skipped): `scenario`/`references`/`conflicts` are not
  part of QC's expected-intent context (see contract-correction note above); QC does not run automatically
  after every render — it's a real, user-triggered "Run QC" action, matching every other AI action in this
  codebase (analysis, reference extraction, generation) being explicitly user-initiated rather than silently
  automatic; regeneration is not looped automatically on repeated failure — each Regenerate click is one
  explicit VERIFY→CREATE cycle, consistent with CLAUDE.md rule 15's "no silent" principle applied to spend
  and to user control over repeated AI calls.

## 31. BUILD 18 Production Hardening Implementation Record

Closes the real gaps a pre-gate audit found across docs/16/§9/§12/§13: rate limiting, an audit log, CORS,
signed asset URLs, and a raw-provider-error leak had **zero** implementation until this gate, despite being
named since Bootstrap. Scope, per the product owner's explicit choice between three tiers: code-level
hardening **plus** real local persistence — not the six vendor decisions §13 also names (cloud host, managed
DB, managed blob store, managed queue, auth provider, observability backend), which stay open, documented
decisions, not fabricated integrations (CLAUDE.md rule 7).

- **Real gap found and closed: provider error bodies leaked unredacted into logs AND client responses.**
  Every adapter/engine (`gemini-vision-engine.ts`, `gemini-reference-engine.ts`, `gemini-qc-engine.ts`,
  `nano-banana-adapter.ts`, `chatgpt-image-adapter.ts`, `veo-adapter.ts`) built its `DomainError.message` by
  interpolating the raw upstream HTTP response body — that string reaches both the structured log (which
  only redacts by known object-key name, not arbitrary text) and the client-facing `ErrorEnvelope`. New
  `sanitizeProviderErrorBody()` (`packages/shared`) truncates to a bounded length and strips long
  opaque-token-shaped substrings (a heuristic, not an exhaustive scanner — documented as such); wired into
  all 8 call sites across the 6 files.
- **Rate limiting** (`packages/shared/src/rate-limiter.ts`, `apps/api/src/rate-limit-middleware.ts`) — an
  in-memory, single-instance fixed-window limiter (real, load-bearing for one process — same "concrete
  engine deferred, contract real now" pattern as `JobQueue`), keyed by remote IP (no auth exists yet).
  Enforced centrally in `server.ts` on every AI-cost route (analysis, reference extraction, generation, edit,
  view, video, QC, regenerate) — never inside individual route handlers, matching how CORS is already applied
  centrally. `RATE_LIMITED` → HTTP 429.
- **Audit log** (`AuditEvent`/`AuditLogRepository`, `packages/project-core/src/repositories.ts`;
  `SqliteAuditLogRepository`, `packages/storage-adapters`) — append-only, real rows for the operations that
  DO have a real server-side route today: `asset.access` (every `GET /assets/:id`), `generation.regenerate`,
  `asset.delete` (new route, below). Lock enable/disable is explicitly NOT audited — no
  `PATCH /projects/:id/locks` route exists (locks are still resolved entirely client-side, a pre-existing,
  already-documented gap this gate didn't introduce or need to close).
- **CORS allowlist** (`cors.ts`) — the wildcard `Access-Control-Allow-Origin: *` (explicitly flagged in its
  own comment as a BUILD 18 TODO since it was written) is replaced with `parseAllowedOrigins(ALLOWED_ORIGINS)`
  reflecting the request's `Origin` back only when it's on the list; every other origin gets no CORS header
  at all. Defaults to the Vite dev server's own origin so local dev needs zero configuration.
- **Signed, time-limited asset URLs** (`apps/api/src/signed-asset-url.ts`) — `GET /assets/:id` was a plain,
  unguarded fetch by (guessable, sequential in the old in-memory store) id; `AssetStore.getSignedUrl()`
  existed since BUILD 02 but no route ever called it (dead code). `createAssetUrlSigner()` returns `null`
  when `ASSET_URL_SIGNING_SECRET` isn't configured — every asset URL then stays exactly today's plain
  behavior (same graceful-degradation pattern as every optional provider key), so zero existing test needed
  to change. Configured, every URL this API returns (`handleUploadAsset`, every generation/edit/view/
  regenerate's `outputAssetUrls`, video status polls) is HMAC-signed with an expiry, and `handleGetAsset`
  verifies it (`INVALID_ASSET_SIGNATURE` → HTTP 403) before ever recording the audit-log access event.
- **Real deletion** (`handleDeleteAsset`, `DELETE /projects/:id/assets/:assetId`) — `AssetStore.
  scheduleDeletion()` existed since BUILD 02 but no route ever called it; this makes it real and reachable,
  audit-logged. The exact *automatic* retention timeframe (delete after N days unused, etc.) stays the
  documented product/legal decision §13 already names — this only makes on-demand deletion work.
- **Basic observability** (`packages/shared/src/metrics.ts`, `GET /metrics`) — in-process counters
  (`http_requests_total{method,status}`) rendered in the standard Prometheus text-exposition format (a real,
  vendor-agnostic wire format, not a specific vendor's SDK this project has no account for). Latency
  histograms/tracing/a managed backend stay the explicit §13 vendor decision, not fixed here.
- **Real local persistence — `node:sqlite` + local disk, replacing every `InMemory*` class**
  (`packages/storage-adapters`): `SqliteDatabase` (one JSON-blob-per-row table per entity, not a fully
  normalized per-field schema — a deliberate scope boundary, see the file's own doc comment) backs
  `SqliteProjectRepository`/`SqliteVersionRepository`/`SqliteAnalysisRepository`/`SqliteReferenceRepository`/
  `SqliteGenerationRepository`/`SqliteEditRepository`/`SqliteViewRepository`/`SqliteVideoRepository`/
  `SqliteAuditLogRepository`; `LocalDiskAssetStore` writes real files with a JSON metadata sidecar. Both are
  real, durable across process restarts — confirmed live (below) — not another in-memory placeholder, and
  both still sit behind the exact same repository/`AssetStore` interfaces a later managed-Postgres/S3 swap
  (§13) would need, unchanged for every caller. `app-context.ts`'s `dbPath`/`assetsDir` default to
  `':memory:'`/a fresh temp directory when unset, so every existing test and ad hoc `createAppContext()` call
  keeps its exact prior ephemeral-per-context semantics with zero call-site changes; `server.ts`'s real
  startup path passes real paths from `DATABASE_URL`/`ASSET_STORE_URL`.
- **Real tooling incompatibility found and worked around, not silently avoided**: this codebase's test runner
  (Vitest 2.1.9/vite-node) predates `node:sqlite`'s existence and mis-transforms a static `import 'node:sqlite'`
  into a bare, unresolvable `"sqlite"` specifier (reproduced independently with a minimal test file before
  concluding it wasn't a code bug). `SqliteDatabase` loads it via `createRequire(import.meta.url)('node:sqlite')`
  instead — sidesteps vite-node's static import-rewriting entirely, works identically under plain Node, so
  there's exactly one code path for tests and production, documented in the module's own comment.
- **Verified live**: built and ran `apps/api` for real with `DATABASE_URL`/`ASSET_STORE_URL`/
  `ASSET_URL_SIGNING_SECRET`/`ALLOWED_ORIGINS` all set to real values (not test doubles) — created a real
  project, uploaded a real PNG, confirmed the returned asset URL carries a real signature; confirmed a fetch
  with the valid signature succeeds (200), with no signature or a tampered one is rejected (403,
  `INVALID_ASSET_SIGNATURE`); confirmed the real file + metadata sidecar exist on disk; confirmed CORS
  reflects an allowlisted origin and omits the header entirely for `https://evil.example`; hammered the
  analysis endpoint past its real 30-request/minute limit and got a real 429; deleted the asset via the new
  route (204) and confirmed the file is actually gone from disk; read `/metrics` and saw real counts matching
  every call made. **Then killed and restarted the server** and confirmed the same project and (pre-deletion)
  asset were still there — real durability across a restart, the actual point of this tier.
- **447/447 tests pass** (was 426 at the end of BUILD 17); typecheck and lint clean across the whole
  workspace.
- **Explicitly out of scope** (documented, not silently skipped): auth (still fully absent at the time this
  gate closed — **resolved at RELEASE 02, §32**, not by any later BUILD); a managed cloud
  DB/blob/queue/observability vendor and a real cloud hosting target (§13 — genuinely needs the product
  owner's account/credentials, not fabricatable); dev-tooling dependency vulnerabilities in the `vite`/
  `esbuild`/`vitest` chain found during the pre-gate audit (fixing them needs a breaking `vite@8` upgrade,
  a separate, deliberate decision, not bundled into this gate); rate limiting/audit logging are per-process
  only (a real multi-instance deployment needs a shared backend behind the same interfaces, same as
  `JobQueue` already documents for itself).

## 32. RELEASE 02 Security & Production Access Hardening Implementation Record

A post-MVP hardening release (docs/19's BUILD 00-18 gate sequence was already complete and PASS) commissioned
by the product owner after a RELEASE 01 production-readiness audit named the same gap this gate closes: zero
authentication/authorization existed anywhere, and BUILD 18's rate limiting/audit log/CORS/signed URLs all
had nothing behind them to actually gate access to. Scope, per the product owner's explicit constraints: no
managed cloud infrastructure, no fabricated credentials, no rebuild of BUILD 00-18, no SQLite/local-disk swap.

- **Real accounts** (`User`/`AuthenticatedUser`, `packages/project-core/src/user.ts`; `SqliteUserRepository`,
  storage-adapters) — email + password, hashed with `scrypt` (Node's built-in, memory-hard KDF —
  `apps/api/src/auth/password.ts` — no new dependency, same "zero external vendor" pattern BUILD 18 already
  established for storage). `POST /auth/register` is gated by a shared `REGISTRATION_SECRET` — unset,
  registration is entirely disabled (deny-by-default for a private deployment, never open public
  self-registration); this is an invite gate, not a per-user password.
- **Real sessions** (`Session`, `SqliteSessionRepository`; `apps/api/src/auth/session.ts`) — the session id is
  a 256-bit random opaque token, never a self-verifying JWT: every request re-checks the
  `SessionRepository` row, so logout/expiry are real and immediate. Carried in an `HttpOnly`,
  `SameSite=Strict` cookie. `SameSite=Strict` is safe (not merely convenient) because this release also makes
  `apps/web`↔`apps/api` same-origin by design — a dev-time Vite proxy (`apps/web/vite.config.ts`) and, in
  production, the same reverse proxy §11 already requires for TLS — so every real request is same-site.
- **Real authorization** (`resolveOwnedProjectOrThrow()`, `apps/api/src/routes.ts`) — `Project` gained a real
  `ownerId: UserId` field, set only from the session-derived user at creation, never a client-supplied value.
  Every project-scoped route (all of them) resolves ownership through one shared helper; a project that
  exists but belongs to someone else returns the exact same `PROJECT_NOT_FOUND` as one that doesn't exist —
  never leaks existence to a non-owner (IDOR-safe by construction, not by convention). `GET /assets/:id` has
  no `:projectId` in its own URL, so its ownership check resolves via the asset's own recorded `projectId` —
  and now runs *both* the BUILD 18 signature check and this new ownership check, independently; either one
  failing rejects the request.
- **Central enforcement, not per-route** (`apps/api/src/server.ts`) — a hardcoded public allowlist (`GET
  /health`, `GET /metrics`, `POST /auth/register`, `POST /auth/login`; `OPTIONS` is answered before any of
  this for CORS preflight) is checked first; every other path calls `requireAuth()` exactly once, before route
  matching even happens — deliberately: an unauthenticated request to a route that doesn't exist gets `401`,
  not a route-existence-revealing `404` (verified live and in `server.test.ts`).
- **Rate limiting re-keyed** (`apps/api/src/rate-limit-middleware.ts`) — BUILD 18's limiter was IP-keyed
  (no auth existed yet); now that real auth exists, AI-cost routes key by the authenticated user's id (the
  "per user" docs/09/§9 always asked for, finally real) — verified two different accounts are limited
  independently, not globally. `/auth/register`/`/auth/login` stay IP-keyed against a separate, tighter
  limiter (`AUTH_ROUTE_RATE_LIMIT`, 10/min) — they can never have a user id yet by definition.
- **Security response headers** (`apps/api/src/security-headers.ts`) — `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, and
  `Content-Security-Policy: default-src 'none'` (correct, not a compromise: this API never serves HTML/JS
  meant to be rendered as a page). `Strict-Transport-Security` is sent only when `TRUST_HTTPS=true` — this
  app never fakes a TLS assumption it can't back up; sending HSTS over plain HTTP would be actively wrong.
- **`TRUST_HTTPS`** (env.ts) — one new boolean env var (real `"true"`/`"false"` parsing, not zod's
  `z.coerce.boolean()` — that treats the literal string `"false"` as truthy, a well-known footgun this
  deliberately avoids) gates both the cookie's `Secure` attribute and HSTS. Defaults `false` so local dev over
  plain HTTP keeps working with zero configuration.
- **`.gitignore` closed the RELEASE 01 finding for real**: `/data/`, `**/data/`, `*.sqlite3*`, `*.db*`,
  `tmp/`, `.tmp/` — the documented default `DATABASE_URL`/`ASSET_STORE_URL` paths (and any project
  subdirectory choosing the same convention) can no longer be committed by accident.
- **Real tooling migration handled mechanically, not by hand-waving**: every BUILD 06-18 route-level
  integration test called `fetch()` with no session and would have failed the moment auth was enforced. A
  shared `apps/api/src/test-helpers/auth.ts` (`registerTestUser()`, `withCookie()`) was established in
  `routes.test.ts` first, then applied identically across `analysis-route.test.ts`,
  `reference-route.test.ts`, `generation-route.test.ts`, `generation-qc-route.test.ts`, `edit-route.test.ts`,
  `view-route.test.ts`, `video-route.test.ts` — zero assertions/status codes/error codes changed, only real
  auth plumbing added, preserving every prior gate's actual test coverage rather than reducing it.
- **New dedicated coverage**: `apps/api/src/auth/auth-routes.test.ts` (register/login/logout/me, safe
  generic credential errors, rate limiting), `apps/api/src/authorization.test.ts` (two real accounts,
  cross-user IDOR on projects/assets/uploads/analysis, client-supplied `ownerId` ignored), `apps/api/src/
  security-hardening.test.ts` (security headers, HSTS/Secure-cookie gating, path traversal, per-user rate
  limiting, secret redaction).
- **`apps/web` gained a real sign-in gate** (`AuthGate`, `App.tsx`) — every mount now checks `GET /auth/me`
  once before rendering anything else: `'checking'` renders nothing (never flashes the gate for an
  already-signed-in user on reload), `'signedOut'` renders `AuthGate` (a real sign-in/register form, the
  register mode only ever offered as a toggle — it still fails honestly server-side if `REGISTRATION_SECRET`
  isn't configured or doesn't match) and never the real app underneath it, `'signedIn'` renders the app
  exactly as before. `client.ts`'s `API_BASE_URL` now defaults to a relative (same-origin) path and every
  request sets `credentials: 'include'`. `Header` gained a real "Sign out" action that clears the whole
  client-side session state, not just `currentUser`.
- **Verified live**: built and ran the real server with `REGISTRATION_SECRET`/`TRUST_HTTPS`/
  `ASSET_URL_SIGNING_SECRET`/`ALLOWED_ORIGINS`/`DATABASE_URL`/`ASSET_STORE_URL` all set to real values —
  registered two real accounts, confirmed an unauthenticated request to a protected route is rejected (401),
  confirmed account B cannot read/see account A's project (404, not leaked), confirmed account B cannot
  fetch account A's asset even with A's exact valid signed URL (404 — ownership gates independently of the
  signature), confirmed a request with no signature at all is still rejected (403) even on the owner's own
  session, confirmed real security headers and CORS allow/reject, confirmed login/register rate limiting
  (429 after repeated attempts, including correctly rate-limiting a subsequent *legitimate* login attempt
  from the same source — the real, intended behavior of a hard rate limit).
- **487/487 tests pass** (was 447 at the end of BUILD 18); typecheck, lint, and production build all clean;
  `git diff --check` reported no whitespace errors.
- **Explicitly out of scope** (documented, not silently skipped): a managed identity provider (§13); a
  password-reset/email-verification flow (none exists — an operator who loses a password today has no
  self-service recovery path, only re-registration under a new email if registration is still open); TLS
  itself (§11 — a reverse proxy's job, never faked here); the dev-tooling vulnerability chain from BUILD 18's
  audit (unchanged, still needs a deliberate `vite@8` upgrade); defense-in-depth path validation inside
  `LocalDiskAssetStore` itself (not reachable today — the HTTP route regex and WHATWG URL normalization
  already prevent a slash from ever reaching it — flagged as a nice-to-have, not a real gap).

## 33. BUILD 19 Production Readiness / Live AI / Account Recovery Implementation Record

Closes two of RELEASE 02's own explicitly-out-of-scope items (password reset, and a documented identity
boundary), audits the six real AI provider adapters for production-shaped failure handling, adds a real
dependency-readiness endpoint, and adds one fail-fast production config rule. No managed cloud infrastructure
was introduced — this remains a zero-external-vendor deployment (§13 still open) until an operator chooses one.

- **Account recovery** (`apps/api/src/auth/reset-token.ts`, `email-sender.ts`; `PasswordResetToken`,
  `packages/project-core/src/user.ts`; `SqlitePasswordResetTokenRepository`, storage-adapters) — a real,
  single-use, hashed, expiring token flow. The raw token (`randomBytes(32)`, base64url) is only ever emailed;
  the DB stores its SHA-256 hash (fast hash deliberately chosen over `scrypt` here — the token is already
  256 bits of real entropy, not a user-chosen secret, so a slow KDF buys nothing and only cheapens the
  operation). `POST /auth/password-reset/request` always returns the same generic 202 whether or not the
  email exists (enumeration-safe by construction); `POST /auth/password-reset/confirm` rejects an
  unknown/expired/already-used token with one generic `INVALID_OR_EXPIRED_RESET_TOKEN`, and on success
  updates the password hash, marks the token used (never deleted — an append-only fact), and calls
  `SessionRepository.deleteAllForUser()` so every existing session is revoked, not just the one that reset it.
  Both endpoints sit behind their own IP-keyed `PASSWORD_RESET_RATE_LIMIT` (5/min). The real vendor choice for
  actually sending an email stays deliberately deferred — `EmailSender` is a real interface,
  `InMemoryEmailSender` (records sends in an array) is its only implementation today, the same
  "concrete engine deferred, interface real" pattern BUILD 18 already established for `JobQueue`/`AssetStore`.
- **Identity provider boundary** (`apps/api/src/auth/identity-provider.ts`) — `requireAuth()`
  (`apps/api/src/auth/session.ts`) no longer looks up a session/user row itself; it delegates entirely to an
  injected `IdentityProvider.verifySession()`. `createLocalIdentityProvider()` is the only implementation
  today (wraps the same real `SessionRepository`/`UserRepository` RELEASE 02 already built) — a managed
  provider (Auth0/Clerk/Cognito/etc.) would implement this same three-method-shaped interface without
  `requireAuth()` or any route changing at all. Chosen over adopting a managed provider outright because no
  such vendor was requested or available to validate against; the boundary exists so that choice is a future,
  isolated swap, not a rewrite.
- **Live AI provider audit** (all 6 real adapters: Gemini vision/reference/QC, Nano Banana, ChatGPT Image,
  Veo) — every provider fetch now goes through `packages/shared/src/fetch-timeout.ts`'s `fetchWithTimeout()`
  (a real `AbortController`, 60s default; Veo's video *download* specifically uses 180s, since a real
  rendered video is larger/slower than a JSON response), with a real `ProviderTimeoutError` caught and
  re-classified into each adapter's own existing error code (`retryable: true`) rather than left to hang or
  surface as an opaque generic failure. No retry-on-timeout was added server-side — deliberately: image/video
  generation is not free to blindly re-submit (real cost, possible duplicate output), and BUILD 17's
  regenerate route already gives the caller an explicit, deliberate retry path once, which is the right layer
  for this decision, not a silent background retry. No unified `AIProvider { analyze, generate, edit, health }`
  interface was introduced: the six adapters already sit behind narrower, real, per-capability interfaces
  (`VisionAnalysisEngine`, `ReferenceIntelligence`, `AiQc`, `ImageGenerationAdapter`, video adapters) that
  cleanly separate meaningfully different request/response shapes; collapsing them would be a rewrite with no
  behavioral benefit (CLAUDE.md rule 8). Everything else RELEASE 01/02 already verified for these adapters —
  server-side-only secret handling, no key ever reaching a client response or log, provider-specific error
  classification, request-size limits, generated-asset persistence, and job-status failure cleanup (a thrown
  `generate()` marks the job `failed` and rethrows *before* any asset write — no orphaned partial output) —
  was re-confirmed unchanged, not re-implemented.
- **`GET /ready`** (`apps/api/src/readiness.ts`) — distinct from BUILD 18's unconditional `GET /health`
  ("process is alive"): this runs one real, cheap probe against each dependency a request genuinely can't
  succeed without (`ProjectRepository.getById()` and `AssetStore.get()`, both against a random,
  guaranteed-absent id — never a table scan, never real data touched), returns `200`/`ready` only when both
  report `ok`, else `503`/`not_ready` with a per-check `ok`/`error` detail — never a stack trace, a file path,
  or a secret. Queue/logging/metrics/error-monitoring boundaries were audited, not rebuilt: `JobQueue`,
  `createConsoleLogger()`, and `createInMemoryMetrics()` (`GET /metrics`) are already real, swappable
  interfaces from BUILD 17/18 with no BUILD 19 gap found in them worth a code change.
- **One new fail-fast production config rule** (`packages/shared/src/env.ts`'s `serverEnvSchema.superRefine()`)
  — `TRUST_HTTPS=true` without `ASSET_URL_SIGNING_SECRET` now refuses to start, rather than silently serving
  unsigned asset URLs in what the operator declared a trusted-HTTPS deployment. No other field was made
  mandatory: e.g. `REGISTRATION_SECRET` unset stays a valid, intentional "registration permanently closed"
  choice, not a misconfiguration (§13, unchanged reasoning). No new env var names were introduced.
- **Live provider smoke test** (`apps/api/src/live-provider-smoke.test.ts`) — real network calls through the
  real HTTP pipeline (real session, real project-ownership check, real asset persistence, real secure asset
  retrieval), but only when `RUN_LIVE_PROVIDER_SMOKE_TEST=true` is set; each provider sub-suite is additionally
  gated on its own real API key being present, so normal CI (no env vars set) makes zero network calls and
  needs zero credentials — the suite reports as *skipped*, never as a fake pass. Every asset it creates is
  deleted via the real `DELETE` route at the end of its own test, so a live run never accumulates test images
  in whatever `ASSET_STORE_URL` is configured. One sub-test (unconfigured `Google Flow` provider) needs no
  credential at all and exercises real failure behavior end-to-end.
- **514/514 tests pass, 1 correctly skipped** (was 487 at the end of RELEASE 02); typecheck, lint, and
  production build all clean; `git diff --check` reported no whitespace errors; diff manually scanned for
  secret-shaped literals before commit — none found (only fixture passwords matching the existing
  `TEST_PASSWORD` convention).
- **Honestly unverified, by design**: no `GEMINI_API_KEY`/`NANO_BANANA_API_KEY`/`CHATGPT_IMAGE_API_KEY`/
  `VEO_API_KEY` exists in this environment, so none of the six AI providers has ever actually been exercised
  against its real API in this session — only validated against current provider documentation and proven via
  the fetch-timeout mechanism's own real (non-mocked-timer) test. Real email delivery (SMTP/SES/SendGrid/etc.)
  remains unimplemented — `InMemoryEmailSender` only. A managed identity provider remains unimplemented — the
  boundary exists, nothing implements it but the local one. This is a **PRODUCTION CANDIDATE**, not
  PRODUCTION READY: the remaining gap to PRODUCTION READY is exclusively external infrastructure this
  environment cannot supply (a real email vendor, a real managed DB/object-store/queue if the operator wants
  one instead of node:sqlite/local-disk, and — before any AI feature is trusted in production — actually
  running each provider once against a real credential).
