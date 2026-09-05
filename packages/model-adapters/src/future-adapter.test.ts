import { describe, expect, it } from 'vitest';
import { FutureAdapter } from './future-adapter.js';
import { ImageGenerationService } from './service.js';

describe('FutureAdapter + ImageGenerationService (provider-agnosticism contract)', () => {
  it('generates successfully for a valid request', async () => {
    const adapter = new FutureAdapter();
    const result = await adapter.generate({
      requestId: 'req-1',
      promptText: 'a modern villa at golden hour',
      sourceAssets: [{ data: new Uint8Array([1, 2, 3]), contentType: 'image/png' }],
      referenceAssets: [],
      aspectRatio: '16:9',
      resolution: '2K',
    });
    expect(result.status).toBe('succeeded');
    expect(result.outputAssetUrls).toHaveLength(1);
  });

  it('fails validation without throwing for an empty prompt', async () => {
    const adapter = new FutureAdapter();
    const result = await adapter.generate({
      requestId: 'req-2',
      promptText: '',
      sourceAssets: [{ data: new Uint8Array([1, 2, 3]), contentType: 'image/png' }],
      referenceAssets: [],
      aspectRatio: '16:9',
      resolution: '2K',
    });
    expect(result.status).toBe('failed');
  });

  it('is resolved by ImageGenerationService without the caller touching a provider-specific type', async () => {
    const service = new ImageGenerationService({ 'nano-banana': new FutureAdapter() });
    const adapter = service.resolve('nano-banana');
    expect(adapter.id).toBe('future-adapter-test-double');
  });

  it('rejects an unknown render core rather than silently falling back', () => {
    const service = new ImageGenerationService({});
    expect(() => service.resolve('google-flow')).toThrow(expect.objectContaining({ code: 'UNKNOWN_RENDER_CORE' }));
  });
});
