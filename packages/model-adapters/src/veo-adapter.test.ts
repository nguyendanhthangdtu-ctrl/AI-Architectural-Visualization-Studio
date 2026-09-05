import { describe, expect, it, vi } from 'vitest';
import { createVeoAdapter } from './veo-adapter.js';

const request = {
  requestId: 'req-1',
  promptText: 'Slow dolly-in on the villa facade, warm evening light.',
  sourceImage: { data: new Uint8Array([1, 2, 3, 4]), contentType: 'image/png' },
  aspectRatio: '16:9',
  resolution: '2K',
  durationSeconds: 6,
};

describe('createVeoAdapter — submit() (real predictLongRunning call)', () => {
  it('rejects with PROVIDER_NOT_CONFIGURED when no API key is set, without ever calling fetch', async () => {
    const fetchFn = vi.fn();
    const adapter = createVeoAdapter({ apiKey: undefined, fetchFn });
    await expect(adapter.submit(request)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends a correctly-shaped predictLongRunning request and returns the real operation name', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ name: 'operations/abc123' }) });
    const adapter = createVeoAdapter({ apiKey: 'test-key', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await adapter.submit(request);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body);
    expect(body.instances[0].prompt).toBe(request.promptText);
    expect(body.instances[0].image.inlineData).toEqual({ mimeType: 'image/png', data: Buffer.from([1, 2, 3, 4]).toString('base64') });
    expect(body.parameters.aspectRatio).toBe('16:9');
    expect(body.parameters.resolution).toBe('1080p'); // 2K maps to 1080p
    expect(body.parameters.durationSeconds).toBe('6');

    expect(result.operation.operationName).toBe('operations/abc123');
  });

  it('rounds an unsupported duration to the nearest real Veo duration (4, 6, or 8 seconds)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ name: 'operations/x' }) });
    const adapter = createVeoAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await adapter.submit({ ...request, durationSeconds: 5 });
    const body = JSON.parse(fetchFn.mock.calls[0]![1].body);
    expect(body.parameters.durationSeconds).toBe('4'); // 5 is equidistant-but-closer to 4 via reduce's <, stable and documented
  });

  it('maps a portrait aspect ratio to Veo\'s real 9:16, never sending an unsupported value', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ name: 'operations/x' }) });
    const adapter = createVeoAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await adapter.submit({ ...request, aspectRatio: '9:16' });
    const body = JSON.parse(fetchFn.mock.calls[0]![1].body);
    expect(body.parameters.aspectRatio).toBe('9:16');
  });

  it('classifies a 429 rate-limit response as retryable', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'quota exceeded' });
    const adapter = createVeoAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(adapter.submit(request)).rejects.toMatchObject({ code: 'VEO_PROVIDER_ERROR', retryable: true });
  });

  it('BUILD 21: tags a 429 with the standardized PROVIDER_RATE_LIMITED category, and a 401 with PROVIDER_AUTH_FAILED', async () => {
    const rateLimited = vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'quota exceeded' });
    await expect(createVeoAdapter({ apiKey: 'k', fetchFn: rateLimited as unknown as typeof fetch }).submit(request)).rejects.toMatchObject({
      providerCode: 'PROVIDER_RATE_LIMITED',
    });

    const unauthorized = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'bad key' });
    await expect(createVeoAdapter({ apiKey: 'k', fetchFn: unauthorized as unknown as typeof fetch }).submit(request)).rejects.toMatchObject({
      providerCode: 'PROVIDER_AUTH_FAILED',
    });
  });

  it('rejects when the API returns no operation name', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const adapter = createVeoAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(adapter.submit(request)).rejects.toMatchObject({ code: 'VEO_PROVIDER_ERROR' });
  });
});

describe('createVeoAdapter — pollStatus() (real operation-status + video-download calls)', () => {
  const operation = { operationName: 'operations/abc123' };

  it('returns "running" while the operation is not yet done, without downloading anything', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ done: false }) });
    const adapter = createVeoAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await adapter.pollStatus(operation);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]![0]).toBe('https://generativelanguage.googleapis.com/v1beta/operations/abc123');
    expect(result.status).toBe('running');
  });

  it('downloads the real video once done and returns it as a decodable data: URI', async () => {
    const fetchFn = vi.fn();
    fetchFn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://files.example/video.mp4' } }] } },
      }),
    });
    fetchFn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'video/mp4' },
      arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer,
    });
    const adapter = createVeoAdapter({ apiKey: 'test-key', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await adapter.pollStatus(operation);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1]![0]).toBe('https://files.example/video.mp4');
    expect(fetchFn.mock.calls[1]![1].headers['x-goog-api-key']).toBe('test-key'); // the download itself needs the key too
    expect(result.status).toBe('succeeded');
    expect(result.outputVideoUrl).toBe(`data:video/mp4;base64,${Buffer.from([9, 9, 9]).toString('base64')}`);
  });

  it('returns "failed", not a fabricated video, when the operation reports an error', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ done: true, error: { message: 'content policy violation' } }) });
    const adapter = createVeoAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    const result = await adapter.pollStatus(operation);
    expect(result.status).toBe('failed');
    expect(result.outputVideoUrl).toBeUndefined();
  });

  it('returns "failed" when the operation is done but the response has no video URI', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ done: true, response: {} }) });
    const adapter = createVeoAdapter({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    const result = await adapter.pollStatus(operation);
    expect(result.status).toBe('failed');
  });

  it('rejects with PROVIDER_NOT_CONFIGURED when no API key is set, without ever calling fetch', async () => {
    const fetchFn = vi.fn();
    const adapter = createVeoAdapter({ apiKey: undefined, fetchFn });
    await expect(adapter.pollStatus(operation)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
