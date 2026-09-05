import { DomainError } from '@avs/shared';
import type { ImageGenerationAdapter } from './adapter.js';

export type RenderCoreSelection = 'nano-banana' | 'google-flow' | 'chatgpt-image' | 'auto';

/**
 * ImageGenerationService — docs/03_TECHNICAL_ARCHITECTURE.md §6. Resolves a
 * render-core selection to a concrete adapter without the caller ever
 * touching a provider-specific type.
 */
export class ImageGenerationService {
  constructor(private readonly adapters: Record<string, ImageGenerationAdapter>) {}

  resolve(renderCore: RenderCoreSelection): ImageGenerationAdapter {
    if (renderCore === 'auto') {
      const first = Object.values(this.adapters)[0];
      if (!first) {
        throw new DomainError({
          code: 'NO_ADAPTERS_REGISTERED',
          message: 'No adapters registered for Auto selection.',
          retryable: false,
        });
      }
      return first;
    }
    const adapter = this.adapters[renderCore];
    if (!adapter) {
      throw new DomainError({
        code: 'UNKNOWN_RENDER_CORE',
        message: `No adapter registered for "${renderCore}".`,
        retryable: false,
      });
    }
    return adapter;
  }
}
