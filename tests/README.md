# Top-level tests

Per docs/03_TECHNICAL_ARCHITECTURE.md §10:
- Unit tests are colocated with each package (`packages/*/src/**/*.test.ts`, `apps/*/src/**/*.test.ts`).
- This directory holds cross-package integration, E2E, and AI-evaluation tests once there is
  application behavior to exercise across boundaries (BUILD 06 onward).

## AI evaluation
`ai-eval/` will run Vision Analysis Engine and QC scoring regression checks against a fixed
`/test-dataset` of representative Architecture/Interior viewport images (docs/17_TEST_STRATEGY.md).
That dataset does not exist yet — flagged in BUILD 00 and BUILD 01 as required before BUILD 07.
