# Model Adapter Specification

interface ImageGenerationAdapter {
  generate(request): Promise<GenerationResult>
}

Each adapter maps the canonical generation request to provider-specific capabilities.

Required adapter behavior:
- capability declaration
- request validation
- provider call
- normalized status
- normalized errors
- output asset registration
- usage metadata
- retry classification

Provider availability and API capabilities must be verified against current official documentation before implementation.
