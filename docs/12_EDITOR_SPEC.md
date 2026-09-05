# Advanced Editor

Capabilities:
- Select / Mask / Brush
- Inpaint / Outpaint
- Material replacement
- Furniture/object replacement
- People / trees / vegetation / vehicles / decor / environment
- Lighting and atmosphere edits

Each edit must declare:
- target region
- intended change
- protected regions/locks
- parent generation
- resulting asset

## Status (BUILD 14)
Real for two of three adapters: `ChatGPTImageAdapter.edit()` (genuine masked/whole-image edit via OpenAI's
`/images/edits`, real pixel mask) and `NanoBananaAdapter.edit()` (whole-image instructed edit — Gemini's
Interactions API has no documented alpha-mask input, so a supplied mask is passed as an extra image with a
textual region instruction, not real pixel compositing). Google Flow stays `NOT_IMPLEMENTED` (BUILD 12
finding — no official public API). `POST /projects/:id/generations/:generationId/edits`
(`apps/api/src/routes.ts`) always reuses the parent generation's own provider.

All five required declarations are real: `EditRecord` (packages/project-core/src/repositories.ts) persists
target region, intended change, protected locks (the real current lock state), parent generation id, and
resulting asset id. `EDIT_CATEGORIES` (edit-vocabulary.ts) gives "Material replacement," "Furniture/object
replacement," "People/vegetation/vehicles/decor/environment," "Lighting and atmosphere," and "Inpaint/
outpaint" a structured label — the actual edit is always the freeform `intendedChange` text, so none needed
category-specific logic. "Select / Mask / Brush" as a freehand canvas tool is not built — "target region" is
real, declared, text-described input; the `maskAsset`/`maskAssetId` plumbing is real end-to-end (both
adapters, the route, the schema) ahead of that UI, not blocked on it.
