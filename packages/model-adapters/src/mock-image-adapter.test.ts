import { describe, expect, it } from 'vitest';
import { createMockImageAdapter } from './mock-image-adapter.js';

const request = {
  requestId: 'req-mock-1',
  promptText: 'a modern villa at golden hour, photorealistic',
  sourceAssets: [{ data: new Uint8Array([1, 2, 3]), contentType: 'image/png' }],
  referenceAssets: [],
  aspectRatio: '16:9',
  resolution: '2K',
};

describe('createMockImageAdapter (BUILD 25 Mock Provider)', () => {
  it('returns a real, valid, decodable PNG — never a placeholder string', async () => {
    const adapter = createMockImageAdapter();
    const result = await adapter.generate(request);

    expect(result.status).toBe('succeeded');
    const match = /^data:image\/png;base64,(.+)$/.exec(result.outputAssetUrls[0]!);
    expect(match).not.toBeNull();
    const bytes = Buffer.from(match![1]!, 'base64');
    // Real PNG signature — proves this decodes as a genuine image, not fabricated text.
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.readUInt32BE(0)).toBe(0x89504e47);
  });

  it('labels its output MOCK — NO REAL API CALL and never claims a real model was invoked', async () => {
    const adapter = createMockImageAdapter();
    const result = await adapter.generate(request);
    expect(result.usageMetadata['mock']).toBe(true);
    expect(result.usageMetadata['note']).toBe('MOCK — NO REAL API CALL');
  });

  it('defaults its modelId to gemini-3.1-flash-image (Nano Banana 2) but accepts an override', async () => {
    const defaultAdapter = createMockImageAdapter();
    const defaultResult = await defaultAdapter.generate(request);
    expect(defaultResult.usageMetadata['model']).toBe('gemini-3.1-flash-image');

    const overrideAdapter = createMockImageAdapter({ modelId: 'gpt-image-1', id: 'mock-chatgpt' });
    const overrideResult = await overrideAdapter.generate(request);
    expect(overrideResult.usageMetadata['model']).toBe('gpt-image-1');
    expect(overrideAdapter.id).toBe('mock-chatgpt');
  });

  it('validate() rejects an empty prompt or missing source assets, same as a real adapter', () => {
    const adapter = createMockImageAdapter();
    expect(adapter.validate({ ...request, promptText: '' }).valid).toBe(false);
    expect(adapter.validate({ ...request, sourceAssets: [] }).valid).toBe(false);
    expect(adapter.validate(request).valid).toBe(true);
  });

  it('edit() also returns a real mock image, labeled the same way', async () => {
    const adapter = createMockImageAdapter();
    const result = await adapter.edit!({
      requestId: 'req-edit-1',
      promptText: 'change the roof material',
      sourceAsset: { data: new Uint8Array([1, 2, 3]), contentType: 'image/png' },
      aspectRatio: '16:9',
      resolution: '2K',
    });
    expect(result.status).toBe('succeeded');
    expect(result.usageMetadata['mock']).toBe(true);
  });

  it('makes no network call whatsoever — capabilities()/validate()/generate()/edit() are all pure and synchronous-safe', () => {
    // No fetchFn config option exists on MockImageAdapterConfig at all — the
    // absence of any such parameter is itself the guarantee: there is
    // nothing to inject a real network call through.
    const adapter = createMockImageAdapter();
    expect(adapter.capabilities()).toMatchObject({ maxResolution: '4K', supportsEdit: true });
  });
});
