# Image Generation Pipeline

1. Validate request.
2. Freeze input snapshot/version.
3. Create generation job.
4. Compile canonical prompt.
5. Adapt to provider.
6. Submit request.
7. Track status.
8. Store outputs.
9. Store provenance.
10. Run QC.
11. Pass or create correction/regeneration job.

Long-running operations must be asynchronous.

## Status (BUILD 13)
Steps 1-9 are real: `POST /projects/:id/generations` (`apps/api/src/routes.ts`) validates the request,
resolves a real adapter (Nano Banana / ChatGPT Image — BUILD 12; Google Flow stays `NOT_IMPLEMENTED`),
submits it, tracks job status (`JobQueue.updateStatus`), registers real output assets, and persists a
`GenerationRecord` + `GenerationVersion`. Steps 10-11 (QC, correction/regeneration) are BUILD 17. The
concrete async execution engine behind `JobQueue` is still deferred (docs/03 §13, ADR-004) — this gate
executes synchronously within the request, same as the analysis and reference-extraction routes.
