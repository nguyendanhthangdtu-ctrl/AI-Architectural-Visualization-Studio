# UX Specification

## Workspace
- Header: project, model/provider, save/status, UI language toggle (VI | EN).
- Navigation: Architecture, Interior, References, Generations, Editor, Views, Video, Settings.
- Central canvas: source/output visualization.
- Control area: analysis, scenario, reference, prompt inspector.
- Primary Render action should be visually prominent and placed at the end of the generation flow. The
  Advanced Editor (BUILD 14) extends the flow after Render — it only ever has something to edit once a
  generation exists — so Render stays the prominent trigger for generation and precedes the Editor in
  document order, without being the literal last element in the workspace.

## Required controls
Full product control set (see docs/01_PRODUCT_REQUIREMENTS.md for MVP vs Post-MVP phasing; Prompt From Image is Post-MVP and is not required for MVP Build Gate PASS).
- Upload source image.
- Dò prompt từ ảnh / Prompt From Image.
- Reference image and reference purpose.
- Architecture Lock.
- Camera Lock.
- Material Lock.
- Scenario Builder.
- Prompt Inspector.
- Render.
- Advanced Editor (target region, intended change, category) — Post-MVP, docs/12.
- QC result.
- Regenerate.
- UI language toggle (VI | EN) — independent of AI Analysis Language and Prompt Output Language, which are
  configured separately (see docs/09_PROMPT_ENGINE_SPEC.md "Bilingual prompt output"). Changing UI language
  never changes domain/business data, which stays language-neutral.

## UX rules
- Canvas gets priority over secondary analysis panels.
- Prompt editor is below Prompt From Image.
- Do not preload sample images in source/reference canvas unless explicitly required.
- Every AI action shows status and failure reason.
- Destructive edits require confirmation or versioning.
- "Dò prompt từ ảnh" / Prompt From Image remains a first-class workflow entry point regardless of UI language.
