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

## Status (BUILD 12)
- **Nano Banana** — real (`packages/model-adapters/src/nano-banana-adapter.ts`), Google Gemini's native image
  generation (Interactions API). `NANO_BANANA_API_KEY` required.
- **ChatGPT Image** — real (`packages/model-adapters/src/chatgpt-image-adapter.ts`), OpenAI `gpt-image-1`
  Images API. `CHATGPT_IMAGE_API_KEY` required.
- **Google Flow** — stays `NOT_IMPLEMENTED`. Verified against current official documentation (2026-09-04):
  Google publishes no official public REST API for Google Flow itself; its image/video generation is powered
  by models already reachable through other adapters (Nano Banana Pro; Veo via Vertex AI). See
  `packages/model-adapters/src/provider-adapters.ts` for the full finding.
