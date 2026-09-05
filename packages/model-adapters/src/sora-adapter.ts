import { DomainError } from '@avs/shared';
import type { VideoGenerationAdapter } from './video-adapter.js';
import type { VideoAdapterCapabilities, VideoGenerationRequest, VideoOperationRef } from './video-types.js';
import type { NormalizedAdapterError, ValidationResult } from './types.js';

/**
 * Sora (OpenAI) video adapter contract — docs/14_VIDEO_SPEC.md.
 *
 * BUILD 16 research finding (CLAUDE.md rule 13 — verify against CURRENT
 * OFFICIAL documentation before implementing): as of this implementation
 * (accessed 2026-09-05), OpenAI's own documentation states the Sora 2 video
 * generation models and Videos API (`sora-2`, `sora-2-pro`, and their dated
 * variants) are DEPRECATED and scheduled to shut down 2026-09-24 — about
 * three weeks after this build. Implementing a real integration against an
 * API that is already scheduled for imminent shutdown would not be a
 * responsible or durable integration; `submit()`/`pollStatus()` therefore
 * stay `NOT_IMPLEMENTED`, with this finding recorded here rather than
 * silently deferred. Revisit once OpenAI publishes a successor endpoint.
 */
export class SoraAdapter implements VideoGenerationAdapter {
  readonly id = 'sora';

  capabilities(): VideoAdapterCapabilities {
    return { maxDurationSeconds: 0, supportedAspectRatios: [], supportedResolutions: [] };
  }

  validate(request: VideoGenerationRequest): ValidationResult {
    const errors: string[] = [];
    if (!request.promptText.trim()) errors.push('promptText must not be empty');
    if (!request.sourceImage) errors.push('sourceImage must be provided');
    return { valid: errors.length === 0, errors };
  }

  async submit(_request: VideoGenerationRequest): Promise<never> {
    throw new DomainError({
      code: 'NOT_IMPLEMENTED',
      message:
        'Sora adapter is a contract declared at Bootstrap; BUILD 16 found OpenAI\'s Sora 2 Videos API is deprecated and shutting down 2026-09-24 — implementing against it now would not be a durable integration. Use the Veo adapter (Gemini API) for real video generation. See sora-adapter.ts.',
      retryable: false,
    });
  }

  async pollStatus(_operation: VideoOperationRef): Promise<never> {
    throw new DomainError({
      code: 'NOT_IMPLEMENTED',
      message: 'Sora adapter is not implemented (see submit()) — there is no operation to poll.',
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
