# Test Strategy

## Unit
Domain rules, schema validation, lock resolution, prompt compilation, scenario normalization.

## Integration
Storage, AI service boundaries, model adapters, job lifecycle, QC loop.

## E2E
Create project → upload → analyze → scenario → prompt → generate → QC → regenerate.

## AI evaluation
Maintain a fixed test dataset of representative Architecture/Interior viewport images. Evaluate structured analysis and consistency, not only whether a request returns an image.
