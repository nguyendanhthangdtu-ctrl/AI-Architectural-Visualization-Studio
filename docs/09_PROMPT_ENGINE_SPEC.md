# Prompt Engine

## Three levels
1. Analysis Prompt
2. Canonical Master Prompt
3. Provider Model Adapter Prompt

## Master Prompt sections
Subject
Architecture
Style
Camera
Composition
Material
Lighting
Environment
Furniture/Objects
Photography
Realism
Reference
Constraints
Output

## Rule
Never use the generated prompt as the database. Store structured intelligence and compile prompts from it.

## Versioning
Every generation stores prompt compiler version and normalized input snapshot.

## Compiler status (BUILD 11)
`PromptCompiler.compile()` (`packages/prompt-engine/src/compiler.ts`) is real: deterministic composition of
all 14 sections above from an already-resolved `NormalizedRequest` (BUILD 08 Reasoning Engine output) — no
provider call, since every input is already real structured data. `compilePromptOutput()`
(`packages/prompt-engine/src/prompt-output-compiler.ts`) orchestrates `compile()` + `PromptIntelligence`
mapping + `CanonicalPromptDNA` into one `PromptOutput`. Both are pure/no-I/O and are called directly
client-side (`apps/web`'s `ControlPanel`), the same pattern as `scenarioBuilder.normalize()` — no `apps/api`
endpoint exists or is needed for compilation.

## Canonical Prompt DNA (Architecture Amendment, §22 of docs/03)
The user-specified concise/keyword-oriented deliverable format, produced alongside — not instead of — the
Canonical Master Prompt above. Same underlying structured intelligence, different presentation contract:

1. Real-life photography / Ảnh chụp thực tế (default section; stays default unless explicitly changed)
2. Subject / Space
3. Style
4. Details
5. Context
6. Lighting
7. Camera & Photography System
8. Technical / Structural Control
9. Complete copy/paste Prompt (required, bilingual: English + Vietnamese)

Output is concise and keyword-oriented, not prose (enforced by `assertConciseKeywordStyle()` in
`packages/prompt-engine/src/canonical-prompt-dna.ts`). Governing principles carried into every Prompt Output,
regardless of format: strictly adhere to the reference sketch, preserve structural integrity, exact geometry,
no hallucinated details, exact line-art translation, photorealistic, 8K resolution — see `StructuralConstraints`
(`packages/ai-core/src/structural-constraints.ts`). These principles are never silently removed or weakened;
`preserveExactGeometry` etc. only relax when Architecture Lock is explicitly disabled, and
`noHallucinatedDetails`/`photorealistic` never relax at all.

## Bilingual prompt output
Prompt output language (`en` / `vi` / `auto`) is one of three independent language settings — see
`packages/shared/src/language.ts` and docs/03 §22 — distinct from UI language and AI analysis language.
`PromptIntelligence` fields (`packages/prompt-engine/src/prompt-intelligence.ts`) carry both `en` and `vi`
text. As of BUILD 11, Vietnamese for the app's own CLOSED vocabularies (scenario terms, lighting mood tags,
camera classification, structural-constraint phrases) is a real, bounded translation
(`packages/prompt-engine/src/vi-glossary.ts`) — never a general-purpose translator, never a fabricated guess
(`translateKnownTerm()` returns `null`, not a guess, outside that vocabulary). Genuinely freeform text (a
Vision Analysis description sentence) is still mirrored into both fields with an explicit warning rather than
fabricating a translation (CLAUDE.md rule 7) — real full-sentence translation is a distinct, later capability.
`PromptOutput` (`packages/prompt-engine/src/prompt-output.ts`) exposes `masterPromptEn`, `masterPromptVi`
(the same canonical content as `CanonicalPromptDNA`'s "Complete copy/paste Prompt," one per language), and a
combined `bilingualPrompt` (`"EN: ...\n\nVI: ..."`).

## Source vs. reference separation
The source image's Architecture DNA has the highest priority and is never overwritten by a reference image.
A reference image transmits **visual language only** — style, material, lighting, color, composition,
camera, environment, atmosphere, photography, realism — never architecture, unless a future, explicit
authorization mechanism is deliberately introduced (none exists yet). See `SourceArchitectureDNA` /
`ReferenceVisualLanguage` in `packages/ai-core/src/source-reference-separation.ts` and docs/03 §22.

## Prompt Inspector
Before a prompt reaches a provider, the user can inspect and edit any non-locked section (Subject,
Architecture, Style, Camera, Composition, Material, Lighting, Environment, Furniture/Objects, Photography,
Realism, Constraints, Reference Visual Language, User Preference contribution) — see
`packages/prompt-engine/src/prompt-inspector.ts`. Lock-protected sections (Architecture/Camera/Material/
Style/Lighting) reject edits outright rather than silently ignoring or silently accepting them. User edits
update the structured intelligence and, from there, the compiled Master Prompt — never the other way around
(prompts remain compiled artifacts, never the source of truth; see rule above).
