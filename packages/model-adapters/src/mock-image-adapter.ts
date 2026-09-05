import type { ImageGenerationAdapter } from './adapter.js';
import type { AdapterCapabilities, EditRequest, GenerationRequest, GenerationResult, NormalizedAdapterError, ValidationResult } from './types.js';

/**
 * BUILD 25 (Multi-Model Image Engine / Nano Banana 2) — a real, reusable
 * Mock Provider so the full image-generation pipeline (request → generation
 * → output validation → QC → AssetStore → signed URL → round-trip) can be
 * exercised end-to-end with zero network calls and zero billing/quota
 * dependency, whether or not a real `NANO_BANANA_API_KEY`/
 * `CHATGPT_IMAGE_API_KEY` is configured.
 *
 * Implements the exact same `ImageGenerationAdapter` interface every real
 * adapter does — plugs into the existing `ImageGenerationService` unchanged
 * (`app-context.ts`'s wiring, `routes.ts`'s `submitGeneration()`), never a
 * parallel pipeline. Returns a real, valid, decodable 1×1 PNG (the same
 * fixture already used throughout this repo's route tests) as its output —
 * never a placeholder string — so it genuinely passes the real
 * `validateImageOutput()`/`decodeDataUri()` checks (BUILD 21/23), not merely
 * a mock of them.
 *
 * Deliberately NOT registered in `app-context.ts`'s real, production
 * `ImageGenerationService` — it is a test-time tool, constructed directly by
 * whichever test needs it (mirroring how `fakeSucceedingAdapter()` already
 * works in `apps/api/src/generation-route.test.ts`), never a real
 * user-selectable render core. See `docs/BUILD_25_MULTI_MODEL_IMAGE_ENGINE.md`
 * for the full reasoning.
 */
const MOCK_OUTPUT_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export interface MockImageAdapterConfig {
  /** Defaults to `'mock'`. */
  id?: string;
  /** Defaults to `'gemini-3.1-flash-image'` (Nano Banana 2) — see `image-model-registry.ts`. */
  modelId?: string;
}

export function createMockImageAdapter(config: MockImageAdapterConfig = {}): ImageGenerationAdapter {
  const id = config.id ?? 'mock';
  const modelId = config.modelId ?? 'gemini-3.1-flash-image';

  function mockResult(requestId: string): GenerationResult {
    return {
      status: 'succeeded',
      outputAssetUrls: [`data:image/png;base64,${MOCK_OUTPUT_PNG_BASE64}`],
      usageMetadata: {
        adapter: id,
        model: modelId,
        requestId,
        mock: true,
        // Part 17's exact required label — surfaced in usageMetadata so any
        // caller (a UI, a log line) can render "MOCK — NO REAL API CALL"
        // rather than ever implying a real generation happened.
        note: 'MOCK — NO REAL API CALL',
      },
    };
  }

  return {
    id,

    capabilities(): AdapterCapabilities {
      return {
        maxResolution: '4K',
        supportedAspectRatios: ['1:1', '16:9', '9:16'],
        supportsEdit: true,
        supportsUpscale: false,
      };
    },

    validate(request: GenerationRequest): ValidationResult {
      const errors: string[] = [];
      if (!request.promptText.trim()) errors.push('promptText must not be empty');
      if (request.sourceAssets.length === 0) errors.push('sourceAssets must not be empty');
      return { valid: errors.length === 0, errors };
    },

    async generate(request: GenerationRequest): Promise<GenerationResult> {
      return mockResult(request.requestId);
    },

    async edit(request: EditRequest): Promise<GenerationResult> {
      return mockResult(request.requestId);
    },

    normalizeError(providerError: unknown): NormalizedAdapterError {
      return {
        code: 'MOCK_PROVIDER_ERROR',
        message: providerError instanceof Error ? providerError.message : String(providerError),
        retryable: false,
      };
    },
  };
}
