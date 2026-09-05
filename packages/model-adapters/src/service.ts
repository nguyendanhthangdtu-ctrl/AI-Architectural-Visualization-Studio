import { DomainError } from '@avs/shared';
import type { ImageGenerationAdapter } from './adapter.js';

/** BUILD 27 FIX — 'auto' removed: real model selection only, no "let the server pick" fallback strategy. */
export type RenderCoreSelection = 'nano-banana' | 'nano-banana-pro' | 'google-flow' | 'chatgpt-image';

/**
 * ImageGenerationService — docs/03_TECHNICAL_ARCHITECTURE.md §6. Resolves a
 * render-core selection to a concrete adapter without the caller ever
 * touching a provider-specific type.
 */
export class ImageGenerationService {
  constructor(private readonly adapters: Record<string, ImageGenerationAdapter>) {}

  resolve(renderCore: RenderCoreSelection): ImageGenerationAdapter {
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
