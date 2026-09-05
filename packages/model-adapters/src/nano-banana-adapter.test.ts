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
    expect(body.response_format.aspect_ratio).toBe('16:9');
    expect(body.response_format.image_size).toBe('2K'); // BUILD 25 — request.resolution === '2K' maps 1:1

    expect(result.status).toBe('succeeded');
    expect(result.outputAssetUrls[0]).toBe('data:image/jpeg;base64,ZmFrZS1pbWFnZS1ieXRlcw==');
    expect(result.providerJobId).toBe('interaction-1');
  });

  it('BUILD 25: maps this app\'s own resolution vocabulary to Nano Banana 2\'s real image_size values (uppercase K, capped at 4K)', async () => {
    const cases: [string, string][] = [
      ['Preview', '1K'],
      ['2K', '2K'],
      ['4K', '4K'],
      ['6K', '4K'],
      ['8K/Ultra', '4K'],
      ['', '1K'],
    ];
    for (const [appResolution, expectedImageSize] of cases) {
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ output_image: { data: 'aW1n', mime_type: 'image/jpeg' } }) });
      const adapter = createNanoBananaAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
      await adapter.generate({ ...request, resolution: appResolution });
      const body = JSON.parse(fetchFn.mock.calls[0]![1].body);
      expect(body.response_format.image_size, `resolution "${appResolution}"`).toBe(expectedImageSize);
    }
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

  it('classifies a genuine (non-quota) 429 rate-limit response as retryable, and BUILD 23: bounded-retries it before giving up', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'too many requests, please slow down' });
    const adapter = createNanoBananaAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch, retryBackoffMs: 1 });
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: 'NANO_BANANA_PROVIDER_ERROR', retryable: true, providerCode: 'PROVIDER_RATE_LIMITED' });
    expect(fetchFn).toHaveBeenCalledTimes(2); // default maxAttempts=2 — bounded, not infinite
  });

  it('BUILD 25: classifies a 429 whose body mentions quota as PROVIDER_QUOTA_EXCEEDED and never retries it — a real Gemini response observed in this project', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'You exceeded your current quota, please check your plan and billing details.',
    });
    const adapter = createNanoBananaAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch, retryBackoffMs: 1 });
    await expect(adapter.generate(request)).rejects.toMatchObject({
      code: 'NANO_BANANA_PROVIDER_ERROR',
      retryable: false,
      providerCode: 'PROVIDER_QUOTA_EXCEEDED',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1); // never retried — retrying an exhausted quota immediately can never succeed
  });

  it('BUILD 23: retries a 5xx once, then succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable', text: async () => 'down' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ output_image: { data: 'aW1n', mime_type: 'image/jpeg' } }) });
    const adapter = createNanoBananaAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch, retryBackoffMs: 1 });
    const result = await adapter.generate(request);
    expect(result.status).toBe('succeeded');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('BUILD 23: never retries a real client-side timeout — the provider may already be mid-generation', async () => {
    const fetchFn = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      });
    });
    const adapter = createNanoBananaAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch, timeoutMs: 5, retryBackoffMs: 1 });
    await expect(adapter.generate(request)).rejects.toMatchObject({ providerCode: 'PROVIDER_TIMEOUT' });
    expect(fetchFn).toHaveBeenCalledTimes(1); // no retry on an ambiguous timeout — cost safety
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

  it('BUILD 27: a config.model/id/capabilities override (Nano Banana Pro) reports its own id and capabilities, sends its own model id, without touching Nano Banana 2\'s defaults', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ output_image: { data: 'aW1n', mime_type: 'image/jpeg' } }) });
    const adapter = createNanoBananaAdapter({
      apiKey: 'k',
      model: 'gemini-3-pro-image',
      id: 'nano-banana-pro',
      capabilities: { maxResolution: '4K', supportedAspectRatios: ['1:1', '3:2', '2:3', '4:3', '16:9', '9:16', '21:9'] },
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(adapter.id).toBe('nano-banana-pro');
    expect(adapter.capabilities().supportedAspectRatios).toEqual(['1:1', '3:2', '2:3', '4:3', '16:9', '9:16', '21:9']);

    const result = await adapter.generate(request);
    const body = JSON.parse(fetchFn.mock.calls[0]![1].body);
    expect(body.model).toBe('gemini-3-pro-image');
    expect(result.usageMetadata['adapter']).toBe('nano-banana-pro');
    expect(result.usageMetadata['model']).toBe('gemini-3-pro-image');

    // The default (no override) instance is completely unaffected — Nano Banana 2's exact prior behavior.
    const defaultAdapter = createNanoBananaAdapter({ apiKey: 'k' });
    expect(defaultAdapter.id).toBe('nano-banana');
    expect(defaultAdapter.capabilities().supportedAspectRatios).toEqual(['1:1', '16:9', '9:16']);
    expect(defaultAdapter.capabilities().maxResolution).toBe('4K');
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
