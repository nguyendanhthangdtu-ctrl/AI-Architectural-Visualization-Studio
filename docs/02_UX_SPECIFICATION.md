# UX Specification

## Workspace
- Header: project, model/provider, save/status.
- Navigation: Architecture, Interior, References, Generations, Editor, Views, Video, Settings.
- Central canvas: source/output visualization.
- Control area: analysis, scenario, reference, prompt inspector.
- Primary Render action should be visually prominent and placed at the end of the generation flow.

## Required controls
- Upload source image.
- Dò prompt từ ảnh / Prompt From Image.
- Reference image and reference purpose.
- Architecture Lock.
- Camera Lock.
- Material Lock.
- Scenario Builder.
- Prompt Inspector.
- Render.
- QC result.
- Regenerate.

## UX rules
- Canvas gets priority over secondary analysis panels.
- Prompt editor is below Prompt From Image.
- Do not preload sample images in source/reference canvas unless explicitly required.
- Every AI action shows status and failure reason.
- Destructive edits require confirmation or versioning.
