import { describe, expect, it, vi } from 'vitest';
import { createGeminiReferenceIntelligenceEngine } from './gemini-reference-engine.js';

const referenceAsset = { assetId: 'r1', data: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png' };

describe('createGeminiReferenceIntelligenceEngine', () => {
  it('rejects with PROVIDER_NOT_CONFIGURED when no API key is set, without ever calling fetch', async () => {
    const fetchFn = vi.fn();
    const engine = createGeminiReferenceIntelligenceEngine({ apiKey: undefined, fetchFn });
    await expect(engine.extract(referenceAsset, 'style')).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends a correctly-shaped request scoped to the requested purpose only', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ output_text: JSON.stringify({ fields: { style: 'Modern', influences: [] }, warnings: [] }) }),
    });
    const engine = createGeminiReferenceIntelligenceEngine({ apiKey: 'test-key', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await engine.extract(referenceAsset, 'style');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body);
    expect(body.input[0].text).toContain('purpose "style"');
    expect(body.input[0].text).not.toContain('purpose "material"');
    expect(body.input[1].mime_type).toBe('image/png');
    expect(body.response_format.schema.properties.fields.properties).toHaveProperty('style');
    expect(body.response_format.schema.properties.fields.properties).not.toHaveProperty('materials');

    expect(result.purpose).toBe('style');
    expect(result.weight).toBe(1);
    expect(result.fields).toEqual({ style: 'Modern', influences: [] });
  });

  it('strips a field the model returned outside the requested purpose vocabulary, including an architecture leak', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        output_text: JSON.stringify({
          fields: { style: 'Modern', architecture: 'boxy massing', geometry: 'rectangular' },
          warnings: [],
        }),
      }),
    });
    const engine = createGeminiReferenceIntelligenceEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await engine.extract(referenceAsset, 'style');

    expect(result.fields).toEqual({ style: 'Modern' });
    expect(result.fields).not.toHaveProperty('architecture');
    expect(result.fields).not.toHaveProperty('geometry');
  });

  it('classifies a 429 rate-limit response as retryable, with the reference-specific error code', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'quota exceeded',
    });
    const engine = createGeminiReferenceIntelligenceEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(engine.extract(referenceAsset, 'lighting')).rejects.toMatchObject({
      code: 'REFERENCE_PROVIDER_ERROR',
      retryable: true,
    });
  });

  it('classifies a 400 client error as not retryable', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request', text: async () => 'bad input' });
    const engine = createGeminiReferenceIntelligenceEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(engine.extract(referenceAsset, 'lighting')).rejects.toMatchObject({
      code: 'REFERENCE_PROVIDER_ERROR',
      retryable: false,
    });
  });

  it('rejects when the model returns output_text that is not valid JSON', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ output_text: 'not json' }) });
    const engine = createGeminiReferenceIntelligenceEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(engine.extract(referenceAsset, 'color')).rejects.toMatchObject({ code: 'REFERENCE_PROVIDER_ERROR' });
  });

  it('rejects when the model output does not match the required structure', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ output_text: JSON.stringify({ nope: true }) }) });
    const engine = createGeminiReferenceIntelligenceEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(engine.extract(referenceAsset, 'color')).rejects.toMatchObject({ code: 'REFERENCE_PROVIDER_ERROR' });
  });
});
