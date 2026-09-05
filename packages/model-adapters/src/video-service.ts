import { DomainError } from '@avs/shared';
import type { VideoGenerationAdapter } from './video-adapter.js';

export type VideoRenderCoreSelection = 'veo' | 'sora' | 'auto';

/**
 * VideoGenerationService — docs/03 §6 pattern, applied to video (BUILD 16).
 * Resolves a render-core selection to a concrete video adapter without the
 * caller ever touching a provider-specific type — same shape as
 * `ImageGenerationService`, kept as a separate class since the underlying
 * adapter interface (`submit`/`pollStatus`, asynchronous) is genuinely
 * different from `ImageGenerationAdapter`'s single `generate()` call.
 */
export class VideoGenerationService {
  constructor(private readonly adapters: Record<string, VideoGenerationAdapter>) {}

  resolve(renderCore: VideoRenderCoreSelection): VideoGenerationAdapter {
    if (renderCore === 'auto') {
      const first = Object.values(this.adapters)[0];
      if (!first) {
        throw new DomainError({
          code: 'NO_ADAPTERS_REGISTERED',
          message: 'No video adapters registered for Auto selection.',
          retryable: false,
        });
      }
      return first;
    }
    const adapter = this.adapters[renderCore];
    if (!adapter) {
      throw new DomainError({
        code: 'UNKNOWN_RENDER_CORE',
        message: `No video adapter registered for "${renderCore}".`,
        retryable: false,
      });
    }
    return adapter;
  }
}
