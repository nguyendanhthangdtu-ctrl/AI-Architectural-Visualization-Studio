# Image → Video

Input:
final image + Project DNA + motion plan.

Motion:
dolly, pan, orbit, crane, push-in, pull-out, people, trees, curtains, light, atmosphere.

Video locks:
architecture, camera, objects, materials, temporal consistency.

## Status (BUILD 16)
Real for Veo, `NOT_IMPLEMENTED` for Sora. Unlike every prior generation route, this is a genuinely
asynchronous pipeline (docs/11 "long-running operations must be asynchronous"): `POST /projects/:id/
generations/:generationId/videos` submits to Veo's real `predictLongRunning` API and returns `202` with
`video.status === 'running'` immediately; `GET /projects/:id/videos/:videoId` polls the real operation and,
on success, downloads and stores the actual generated video bytes. `protectedLocks` on a `VideoRecord` is
always the full 5-item set above — docs/14 names these as fixed guarantees a video generation always
maintains, not a per-request user toggle the way the 5 image Locks are. Sora's Videos API was found to be
deprecated by OpenAI, shutting down 2026-09-24 — its adapter stays `NOT_IMPLEMENTED` rather than integrating
against a system already scheduled for shutdown (same disciplined non-implementation as BUILD 12's Google
Flow finding). UI (`VideoPanel`) exposes motion type/description, duration, and render core, and is the
first component in this codebase polling a real async job to completion. No real `VEO_API_KEY` was available
to exercise the live API end-to-end — see docs/03 §29 for the full implementation record.
