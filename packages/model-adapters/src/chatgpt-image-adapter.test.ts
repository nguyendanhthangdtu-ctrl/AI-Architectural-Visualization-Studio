import { describe, expect, it, vi } from 'vitest';
import { createChatGPTImageAdapter } from './chatgpt-image-adapter.js';

const request = {
  requestId: 'req-1',
  promptText: 'a modern villa at golden hour, photorealistic',
  sourceAssets: [{ data: new Uint8Array([1, 2, 3]), contentType: 'image/png' }],
  referenceAssets: [],
  aspectRatio: '16:9',
  resolution: '2K',
};

describe('createChatGPTImageAdapter', () => {
  it('rejects with PROVIDER_NOT_CONFIGURED when no API key is set, without ever calling fetch', async () => {
    const fetchFn = vi.fn();
    const adapter = createChatGPTImageAdapter({ apiKey: undefined, fetchFn });
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends a correctly-shaped request, mapping aspect ratio to a real gpt-image-1 size and never sending response_format', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: 'ZmFrZS1pbWFnZQ==', revised_prompt: 'a modern villa' }] }),
    });
    const adapter = createChatGPTImageAdapter({ apiKey: 'test-key', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await adapter.generate(request);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect(init.headers.authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-image-1');
    expect(body.size).toBe('1536x1024'); // 16:9 maps to the landscape gpt-image-1 size
    expect(body.quality).toBe('medium'); // 2K maps to medium
    expect(body).not.toHaveProperty('response_format'); // unsupported for gpt-image-1+, always b64_json

    expect(result.status).toBe('succeeded');
    expect(result.outputAssetUrls[0]).toBe('data:image/png;base64,ZmFrZS1pbWFnZQ==');
    expect(result.usageMetadata['revisedPrompt']).toBe('a modern villa');
  });

  it('maps 1:1 to the square size and Preview resolution to low quality', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'x' }] }) });
    const adapter = createChatGPTImageAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await adapter.generate({ ...request, aspectRatio: '1:1', resolution: 'Preview' });
    const body = JSON.parse(fetchFn.mock.calls[0]![1].body);
    expect(body.size).toBe('1024x1024');
    expect(body.quality).toBe('low');
  });

  it('classifies a 429 rate-limit response as retryable', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'quota exceeded' });
    const adapter = createChatGPTImageAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: 'CHATGPT_IMAGE_PROVIDER_ERROR', retryable: true });
  });

  it('classifies a 400 client error as not retryable', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request', text: async () => 'bad prompt' });
    const adapter = createChatGPTImageAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(adapter.generate(request)).rejects.toMatchObject({ code: 'CHATGPT_IMAGE_PROVIDER_ERROR', retryable: false });
  });

  it('returns a failed result, not a fabricated image, when the response has no image data', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) });
    const adapter = createChatGPTImageAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    const result = await adapter.generate(request);
    expect(result.status).toBe('failed');
    expect(result.outputAssetUrls).toEqual([]);
  });

  describe('edit() — real /images/edits call (BUILD 14)', () => {
    const editRequest = {
      requestId: 'edit-1',
      promptText: 'replace the facade with warm wood cladding',
      sourceAsset: { data: new Uint8Array([1, 2, 3]), contentType: 'image/png' },
      aspectRatio: '1:1',
      resolution: '2K',
    };

    it('declares supportsEdit — a real capability, not a leftover false', () => {
      const adapter = createChatGPTImageAdapter({ apiKey: undefined });
      expect(adapter.capabilities().supportsEdit).toBe(true);
      expect(typeof adapter.edit).toBe('function');
    });

    it('rejects with PROVIDER_NOT_CONFIGURED when no API key is set, without ever calling fetch', async () => {
      const fetchFn = vi.fn();
      const adapter = createChatGPTImageAdapter({ apiKey: undefined, fetchFn });
      await expect(adapter.edit!(editRequest)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('sends real multipart/form-data to the edits endpoint, with no explicit content-type header', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'ZWRpdGVk' }] }) });
      const adapter = createChatGPTImageAdapter({ apiKey: 'test-key', fetchFn: fetchFn as unknown as typeof fetch });

      const result = await adapter.edit!(editRequest);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0]!;
      expect(url).toBe('https://api.openai.com/v1/images/edits');
      expect(init.headers).toEqual({ authorization: 'Bearer test-key' }); // no content-type — fetch sets the multipart boundary itself
      expect(init.body).toBeInstanceOf(FormData);
      expect(init.body.get('model')).toBe('gpt-image-1');
      expect(init.body.get('prompt')).toBe(editRequest.promptText);
      expect(init.body.get('image')).toBeInstanceOf(Blob);
      expect(init.body.has('mask')).toBe(false); // no mask supplied — whole-image edit

      expect(result.status).toBe('succeeded');
      expect(result.outputAssetUrls[0]).toBe('data:image/png;base64,ZWRpdGVk');
      expect(result.usageMetadata['masked']).toBe(false);
    });

    it('includes a real mask file when one is supplied', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'x' }] }) });
      const adapter = createChatGPTImageAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
      const result = await adapter.edit!({ ...editRequest, maskAsset: { data: new Uint8Array([9, 9]), contentType: 'image/png' } });
      const form = fetchFn.mock.calls[0]![1].body as FormData;
      expect(form.get('mask')).toBeInstanceOf(Blob);
      expect(result.usageMetadata['masked']).toBe(true);
    });

    it('classifies a 429 rate-limit response as retryable', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'quota exceeded' });
      const adapter = createChatGPTImageAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
      await expect(adapter.edit!(editRequest)).rejects.toMatchObject({ code: 'CHATGPT_IMAGE_PROVIDER_ERROR', retryable: true });
    });

    it('returns a failed result, not a fabricated image, when the response has no image data', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) });
      const adapter = createChatGPTImageAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
      const result = await adapter.edit!(editRequest);
      expect(result.status).toBe('failed');
      expect(result.outputAssetUrls).toEqual([]);
    });
  });
});
