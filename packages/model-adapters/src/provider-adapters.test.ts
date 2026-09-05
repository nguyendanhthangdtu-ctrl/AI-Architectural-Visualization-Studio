import { describe, expect, it } from 'vitest';
import { GoogleFlowAdapter } from './provider-adapters.js';
import { createNanoBananaAdapter } from './nano-banana-adapter.js';
import { createChatGPTImageAdapter } from './chatgpt-image-adapter.js';
import { ImageGenerationService } from './service.js';

const request = {
  requestId: 'req-1',
  promptText: 'a modern villa at golden hour',
  sourceAssets: [{ data: new Uint8Array([1, 2, 3]), contentType: 'image/png' }],
  referenceAssets: [],
  aspectRatio: '16:9',
  resolution: '2K',
};

describe('Google Flow adapter — no official public API exists (BUILD 12 finding), never faked', () => {
  it('declares the contract but never simulates a real response', async () => {
    const adapter = new GoogleFlowAdapter();
    expect(typeof adapter.id).toBe('string');
    expect(adapter.capabilities()).toBeDefined();
    await expect(adapter.generate(request)).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
      message: expect.stringContaining('no official public REST API'),
    });
  });
});

describe('all render-core adapters are resolvable through ImageGenerationService', () => {
  it('resolves each by id, alongside the FutureAdapter test double pattern', () => {
    const service = new ImageGenerationService({
      'nano-banana': createNanoBananaAdapter({ apiKey: undefined }),
      'google-flow': new GoogleFlowAdapter(),
      'chatgpt-image': createChatGPTImageAdapter({ apiKey: undefined }),
    });
    expect(service.resolve('nano-banana').id).toBe('nano-banana');
    expect(service.resolve('google-flow').id).toBe('google-flow');
    expect(service.resolve('chatgpt-image').id).toBe('chatgpt-image');
  });

  it('BUILD 27: resolves nano-banana-pro to its own distinct adapter instance/capabilities, sharing the Nano Banana adapter implementation', () => {
    const service = new ImageGenerationService({
      'nano-banana': createNanoBananaAdapter({ apiKey: undefined }),
      'nano-banana-pro': createNanoBananaAdapter({
        apiKey: undefined,
        model: 'gemini-3-pro-image',
        id: 'nano-banana-pro',
        capabilities: { maxResolution: '4K', supportedAspectRatios: ['1:1', '3:2', '2:3', '4:3', '16:9', '9:16', '21:9'] },
      }),
    });
    expect(service.resolve('nano-banana-pro').id).toBe('nano-banana-pro');
    expect(service.resolve('nano-banana-pro').capabilities().supportedAspectRatios).toContain('21:9');
    expect(service.resolve('nano-banana').capabilities().supportedAspectRatios).not.toContain('21:9');
  });
});
