import { describe, expect, it, vi } from 'vitest';
import { createGeminiVisionAnalysisEngine } from './gemini-vision-engine.js';

const VALID_LAYERS = {
  subject: { confidence: 0.9, warnings: [], data: { type: 'building', description: 'A modern villa.' } },
  architecture: {
    confidence: 0.8,
    warnings: [],
    data: {
      geometry: 'boxy',
      openings: 'large glazing',
      roof: 'flat',
      facade: 'cladding',
      floorPlan: 'open',
      ceiling: 'flat',
      stairs: 'none visible',
      proportions: 'balanced',
    },
  },
  style: { confidence: 0.7, warnings: [], data: { style: 'Modern Contemporary', influences: [] } },
  camera: {
    confidence: 0.6,
    warnings: [],
    data: {
      heightMeters: 1.6,
      lens: 'wide',
      fieldOfViewDegrees: 60,
      perspective: 'eye level',
      eyeLevel: 'standing',
      projection: 'perspective',
      verticalCorrection: 'none',
    },
  },
  composition: {
    confidence: 0.7,
    warnings: [],
    data: {
      leadingLines: 'strong',
      ruleOfThirds: 'centered',
      goldenRatio: 'n/a',
      symmetry: 'symmetric',
      balance: 'balanced',
      negativeSpace: 'sky',
      hierarchy: 'building first',
    },
  },
  material: { confidence: 0.6, warnings: [], data: { materials: [] } },
  lighting: {
    confidence: 0.5,
    warnings: ['ambiguous time of day'],
    data: {
      direction: 'front',
      timeOfDay: 'midday',
      intensity: 'high',
      softness: 'hard',
      shadows: 'sharp',
      colorTemperature: 'neutral',
      artificialLighting: [],
    },
  },
  environment: {
    confidence: 0.6,
    warnings: [],
    data: { setting: 'urban', sky: 'clear', weather: 'sunny', context: 'street' },
  },
  object: { confidence: 0.5, warnings: [], data: { objects: [] } },
  photography: {
    confidence: 0.6,
    warnings: [],
    data: {
      cameraSystemLook: 'full-frame',
      lensBehavior: 'sharp',
      exposure: 'balanced',
      dynamicRange: 'high',
      depth: 'deep',
      imperfections: 'none',
    },
  },
  realLifeLook: { confidence: 0.7, warnings: [], data: { description: 'Professional architectural photography.' } },
  constraints: { confidence: 0.9, warnings: [], data: { notedUncertainties: [] } },
};

const sourceAsset = { assetId: 'a1', data: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png' };

describe('createGeminiVisionAnalysisEngine', () => {
  it('rejects with PROVIDER_NOT_CONFIGURED when no API key is set, without ever calling fetch', async () => {
    const fetchFn = vi.fn();
    const engine = createGeminiVisionAnalysisEngine({ apiKey: undefined, fetchFn });
    await expect(engine.analyze(sourceAsset, 'architecture')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends a correctly-shaped request (validated against current Gemini docs) and parses a valid response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ output_text: JSON.stringify(VALID_LAYERS) }),
    });
    const engine = createGeminiVisionAnalysisEngine({
      apiKey: 'test-key',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await engine.analyze(sourceAsset, 'architecture');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBeTruthy();
    expect(body.input[1].mime_type).toBe('image/png');
    expect(body.input[1].data).toBe(Buffer.from(sourceAsset.data).toString('base64'));
    expect(body.response_format.mime_type).toBe('application/json');

    expect(result.module).toBe('architecture');
    expect(result.layers.subject.data.type).toBe('building');
    expect(result.analysisVersion).toContain('gemini:');
  });

  it('classifies a 429 rate-limit response as retryable', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'quota exceeded',
    });
    const engine = createGeminiVisionAnalysisEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(engine.analyze(sourceAsset, 'architecture')).rejects.toMatchObject({
      code: 'VISION_PROVIDER_ERROR',
      retryable: true,
    });
  });

  it('classifies a 400 client error as not retryable', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request', text: async () => 'bad input' });
    const engine = createGeminiVisionAnalysisEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(engine.analyze(sourceAsset, 'architecture')).rejects.toMatchObject({
      code: 'VISION_PROVIDER_ERROR',
      retryable: false,
    });
  });

  it('rejects when the model returns output_text that is not valid JSON', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ output_text: 'not json' }) });
    const engine = createGeminiVisionAnalysisEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(engine.analyze(sourceAsset, 'architecture')).rejects.toMatchObject({ code: 'VISION_PROVIDER_ERROR' });
  });

  it('rejects when the model output does not match the required structure, rather than returning a half-valid result', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ output_text: JSON.stringify({ subject: VALID_LAYERS.subject }) }), // missing 11 layers
    });
    const engine = createGeminiVisionAnalysisEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(engine.analyze(sourceAsset, 'architecture')).rejects.toMatchObject({ code: 'VISION_PROVIDER_ERROR' });
  });

  it('BUILD 19 Phase 3: real request timeout — a hung upstream connection is rejected as a retryable VISION_PROVIDER_ERROR, not left open indefinitely', async () => {
    const fetchFn = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const engine = createGeminiVisionAnalysisEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch, timeoutMs: 10 });
    await expect(engine.analyze(sourceAsset, 'architecture')).rejects.toMatchObject({
      code: 'VISION_PROVIDER_ERROR',
      retryable: true,
    });
  });
});
