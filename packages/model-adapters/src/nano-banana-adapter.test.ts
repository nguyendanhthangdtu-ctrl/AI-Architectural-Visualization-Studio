import { describe, expect, it, vi } from 'vitest';
import { createNanoBananaAdapter } from './nano-banana-adapter.js';

const request = {
  requestId: 'req-1',
  promptText: 'a modern villa at golden hour, photorealistic',
  sourceAssets: [{ data: new Uint8Array([1, 2, 3, 4]), contentType: 'image/png' }],
  referenceAssets: [],
  aspectRatio: '16:9',
  resolution: '2K',
};

describe('createNanoBananaAdapter', () => {
  it('rejects with PROVIDER_NOT_CONFIGURED when no API key is set, without ever calling fetch', async () => {
    const fetchFn = vi.fn();
    const adapter = createNanoBananaAdapter({ apiKey: undefined, fetchFn });
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends a correctly-shaped Interactions API request with the real source asset bytes, no re-fetch', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'interaction-1', output_image: { data: 'ZmFrZS1pbWFnZS1ieXRlcw==', mime_type: 'image/jpeg' } }),
    });
    const adapter = createNanoBananaAdapter({ apiKey: 'test-key', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await adapter.generate(request);

    expect(fetchFn).toHaveBeenCalledTimes(1); // only the real provider call — no asset re-fetch
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body);
    expect(body.input[0]).toEqual({ type: 'text', text: request.promptText });
    expect(body.input[1]).toEqual({ type: 'image', data: Buffer.from([1, 2, 3, 4]).toString('base64'), mime_type: 'image/png' });
    expect(body.response_format.type).toBe('image');

    expect(result.status).toBe('succeeded');
    expect(result.outputAssetUrls[0]).toBe('data:image/jpeg;base64,ZmFrZS1pbWFnZS1ieXRlcw==');
    expect(result.providerJobId).toBe('interaction-1');
  });

  it('includes reference asset bytes after source asset bytes in the multimodal input', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ output_image: { data: 'x', mime_type: 'image/jpeg' } }),
    });
    const adapter = createNanoBananaAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await adapter.generate({ ...request, referenceAssets: [{ data: new Uint8Array([9, 9]), contentType: 'image/jpeg' }] });
    const body = JSON.parse(fetchFn.mock.calls[0]![1].body);
    expect(body.input).toHaveLength(3); // text + 1 source + 1 reference
    expect(body.input[2]).toEqual({ type: 'image', data: Buffer.from([9, 9]).toString('base64'), mime_type: 'image/jpeg' });
  });

  it('classifies a 429 rate-limit response as retryable', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'quota exceeded' });
    const adapter = createNanoBananaAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: 'NANO_BANANA_PROVIDER_ERROR', retryable: true });
  });

  it('classifies a 400 client error as not retryable', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request', text: async () => 'bad prompt' });
    const adapter = createNanoBananaAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: 'NANO_BANANA_PROVIDER_ERROR', retryable: false });
  });

  it('returns a failed result, not a fabricated image, when the response has no output_image', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'i1' }) });
    const adapter = createNanoBananaAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    const result = await adapter.generate(request);
    expect(result.status).toBe('failed');
    expect(result.outputAssetUrls).toEqual([]);
  });

  it('rejects real, non-empty validation input as valid — never rejects a well-formed request', () => {
    const adapter = createNanoBananaAdapter({ apiKey: undefined });
    expect(adapter.validate(request)).toEqual({ valid: true, errors: [] });
    expect(adapter.validate({ ...request, promptText: '' }).valid).toBe(false);
  });

  describe('edit() — whole-image instructed edit, no true pixel mask (BUILD 14)', () => {
    const editRequest = {
      requestId: 'edit-1',
      promptText: 'replace the facade with warm wood cladding',
      sourceAsset: { data: new Uint8Array([1, 2, 3, 4]), contentType: 'image/png' },
      aspectRatio: '16:9',
      resolution: '2K',
    };

    it('sends the source image with an edit instruction, preserving the rest', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ output_image: { data: 'ZWRpdGVk', mime_type: 'image/jpeg' } }) });
      const adapter = createNanoBananaAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });

      const result = await adapter.edit!(editRequest);

      const body = JSON.parse(fetchFn.mock.calls[0]![1].body);
      expect(body.input).toHaveLength(2); // instruction text + source image, no mask supplied
      expect(body.input[0].text).toContain(editRequest.promptText);
      expect(body.input[0].text).toContain('Preserve everything else exactly');
      expect(body.input[1]).toEqual({ type: 'image', data: Buffer.from([1, 2, 3, 4]).toString('base64'), mime_type: 'image/png' });
      expect(result.outputAssetUrls[0]).toBe('data:image/jpeg;base64,ZWRpdGVk');
    });

    it('includes the mask as an additional image with an explicit region instruction when supplied', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ output_image: { data: 'x', mime_type: 'image/jpeg' } }) });
      const adapter = createNanoBananaAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
      await adapter.edit!({ ...editRequest, maskAsset: { data: new Uint8Array([9, 9]), contentType: 'image/png' } });
      const body = JSON.parse(fetchFn.mock.calls[0]![1].body);
      expect(body.input).toHaveLength(3);
      expect(body.input[0].text).toContain('mask');
      expect(body.input[2]).toEqual({ type: 'image', data: Buffer.from([9, 9]).toString('base64'), mime_type: 'image/png' });
    });

    it('rejects with PROVIDER_NOT_CONFIGURED when no API key is set', async () => {
      const fetchFn = vi.fn();
      const adapter = createNanoBananaAdapter({ apiKey: undefined, fetchFn });
      await expect(adapter.edit!(editRequest)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });
});
