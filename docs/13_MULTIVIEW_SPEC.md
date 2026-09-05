# Multi-view

## Sync View
Change camera while preserving Project DNA and locked attributes.

## Creative View
Generate alternative camera/composition proposals while preserving Architecture DNA.

## Version tree
Every view/generation is linked to its parent version and project snapshot.

## Status (BUILD 15)
Real for both modes. `resolveView()` (`packages/ai-core/src/view.ts`) derives a request-scoped variant of an
already-resolved `NormalizedRequest`: Sync View changes only `cameraDNA` (any material/lighting/style
proposal is structurally ignored — recorded as a warning conflict, not silently applied or dropped);
Creative View may change camera/material/lighting/style, but `ViewProposal` has no field for architecture,
so it can never be overridden by construction. Both modes reuse the exact same downstream pipeline a normal
Render does (BUILD 11 compile, BUILD 13 generate) — a View is "resolve a modified request, then generate
again," not a separate generation mechanism. `POST /projects/:id/views` (`apps/api/src/routes.ts`) persists
a real `ViewRecord`, sets `GenerationRecord.viewId` (scaffolded since BUILD 02, populated for the first time
here), and creates a `kind: 'view'` `GenerationVersion`. UI (`MultiViewPanel`) exposes camera height/lens/
perspective (both modes) and style (Creative only); material/lighting proposals are real end-to-end
(domain function, schema, route) but not wired into this UI yet.
