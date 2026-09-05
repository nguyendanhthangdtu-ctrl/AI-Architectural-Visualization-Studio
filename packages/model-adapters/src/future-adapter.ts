import type { ImageGenerationAdapter } from './adapter.js';
import type {
  AdapterCapabilities,
  GenerationRequest,
  GenerationResult,
  NormalizedAdapterError,
  ValidationResult,
} from './types.js';

/**
 * FutureAdapter — a deterministic, fully-working test double, NOT a real
 * provider. Exists only to prove ImageGenerationService and the core are
 * provider-agnostic (docs/03 §6, §10). Must never be wired into production
 * render-core selection — doing so would violate CLAUDE.md rule 7.
 */
export class FutureAdapter implements ImageGenerationAdapter {
  readonly id = 'future-adapter-test-double';

  capabilities(): AdapterCapabilities {
    return {
      maxResolution: '4K',
      supportedAspectRatios: ['1:1', '16:9', '9:16'],
      supportsEdit: false,
      supportsUpscale: false,
    };
  }

  validate(request: GenerationRequest): ValidationResult {
    const errors: string[] = [];
    if (!request.promptText.trim()) errors.push('promptText must not be empty');
    if (request.sourceAssets.length === 0) errors.push('sourceAssets must not be empty');
    return { valid: errors.length === 0, errors };
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const validation = this.validate(request);
    if (!validation.valid) {
      return { status: 'failed', outputAssetUrls: [], usageMetadata: { errors: validation.errors } };
    }
    return {
      status: 'succeeded',
      outputAssetUrls: [`memory://future-adapter/${request.requestId}.png`],
      usageMetadata: { adapter: this.id, requestId: request.requestId },
      providerJobId: `future-${request.requestId}`,
    };
  }

  normalizeError(providerError: unknown): NormalizedAdapterError {
    return {
      code: 'FUTURE_ADAPTER_ERROR',
      message: providerError instanceof Error ? providerError.message : String(providerError),
      retryable: false,
    };
  }
}
