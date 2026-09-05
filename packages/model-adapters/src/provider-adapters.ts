import { DomainError } from '@avs/shared';
import type { ImageGenerationAdapter } from './adapter.js';
import type {
  AdapterCapabilities,
  GenerationRequest,
  GenerationResult,
  NormalizedAdapterError,
  ValidationResult,
} from './types.js';

/**
 * Google Flow adapter contract — docs/10_MODEL_ADAPTER_SPEC.md,
 * docs/03_TECHNICAL_ARCHITECTURE.md §6/§13.
 *
 * BUILD 12 research finding (CLAUDE.md rule 13 — verify against CURRENT
 * OFFICIAL documentation before implementing): as of this implementation
 * (accessed 2026-09-04), Google has published no official public REST API
 * for Google Flow itself. Flow is a consumer creative app; its image
 * generation is powered by the same Nano Banana Pro model already reachable
 * for real through `NanoBananaAdapter` (Gemini API), and its video
 * generation by Veo (Vertex AI) — neither of which is "the Google Flow API."
 * The only "Google Flow API" found is an unofficial third-party wrapper
 * (useapi.net) that automates a user's own Flow account (session/reCAPTCHA
 * automation, not an official API key) — Google's own developer forum has an
 * open thread from a user asking for exactly this and getting no official
 * answer. Implementing against an unofficial, ToS-adjacent reverse-engineered
 * wrapper would violate CLAUDE.md rule 7 ("never fake a production
 * integration") by presenting something unofficial as a real, supported
 * integration. `generate()` therefore stays intentionally `NOT_IMPLEMENTED`,
 * with this finding recorded here rather than silently deferred again.
 */
export class GoogleFlowAdapter implements ImageGenerationAdapter {
  readonly id = 'google-flow';

  capabilities(): AdapterCapabilities {
    return { maxResolution: 'unverified', supportedAspectRatios: [], supportsEdit: false, supportsUpscale: false };
  }

  validate(request: GenerationRequest): ValidationResult {
    const errors: string[] = [];
    if (!request.promptText.trim()) errors.push('promptText must not be empty');
    if (request.sourceAssets.length === 0) errors.push('sourceAssets must not be empty');
    return { valid: errors.length === 0, errors };
  }

  async generate(_request: GenerationRequest): Promise<GenerationResult> {
    throw new DomainError({
      code: 'NOT_IMPLEMENTED',
      message:
        'Google Flow adapter is a contract declared at Bootstrap; BUILD 12 confirmed no official public REST API exists for Google Flow itself (only an unofficial third-party account-automation wrapper) — use the Nano Banana adapter (Gemini API) for the same underlying image model, or Vertex AI (Veo) for video. See provider-adapters.ts.',
      retryable: false,
    });
  }

  normalizeError(providerError: unknown): NormalizedAdapterError {
    return {
      code: 'PROVIDER_ADAPTER_NOT_IMPLEMENTED',
      message: providerError instanceof Error ? providerError.message : String(providerError),
      retryable: false,
    };
  }
}
