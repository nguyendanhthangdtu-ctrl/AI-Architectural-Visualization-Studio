import { describe, expect, it, vi } from 'vitest';
import type { Lock } from '@avs/project-core';
import { createGeminiQcEngine, computeQcDecision } from './gemini-qc-engine.js';
import type { QCScores, QcNormalizedRequestContext } from './qc.js';
import type { StructuredIntelligence } from './vision-analysis.js';

const sourceAsset = { data: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png' };
const outputAsset = { data: new Uint8Array([1, 2, 3, 4]), contentType: 'image/png' };

const structuredIntelligence = {
  analysisVersion: 'gemini:test:2026-01-01',
  module: 'architecture',
  layers: {
    subject: { confidence: 1, warnings: [], data: { type: 'building', description: 'a house' } },
    architecture: {
      confidence: 1,
      warnings: [],
      data: {
        geometry: 'boxy',
        openings: 'large windows',
        roof: 'flat',
        facade: 'concrete',
        floorPlan: 'open',
        ceiling: 'high',
        stairs: 'none visible',
        proportions: 'balanced',
      },
    },
    style: { confidence: 1, warnings: [], data: { style: 'Modern', influences: [] } },
    camera: {
      confidence: 1,
      warnings: [],
      data: {
        heightMeters: 1.6,
        lens: 'wide',
        fieldOfViewDegrees: 60,
        perspective: 'eye-level',
        eyeLevel: 'standing',
        projection: 'perspective',
        verticalCorrection: 'none',
      },
    },
    composition: {
      confidence: 1,
      warnings: [],
      data: {
        leadingLines: 'none',
        ruleOfThirds: 'centered',
        goldenRatio: 'n/a',
        symmetry: 'symmetric',
        balance: 'balanced',
        negativeSpace: 'sky',
        hierarchy: 'building first',
      },
    },
    material: { confidence: 1, warnings: [], data: { materials: [] } },
    lighting: {
      confidence: 1,
      warnings: [],
      data: {
        direction: 'front',
        timeOfDay: 'day',
        intensity: 'bright',
        softness: 'soft',
        shadows: 'soft',
        colorTemperature: 'neutral',
        artificialLighting: [],
      },
    },
    environment: { confidence: 1, warnings: [], data: { setting: 'suburban', sky: 'clear', weather: 'sunny', context: 'yard' } },
    object: {
      confidence: 1,
      warnings: [],
      data: { objects: [{ label: 'front door', category: 'opening', suggestedAction: 'keep' }] },
    },
    photography: {
      confidence: 1,
      warnings: [],
      data: { cameraSystemLook: 'DSLR', lensBehavior: 'sharp', exposure: 'balanced', dynamicRange: 'high', depth: 'deep', imperfections: 'none' },
    },
    realLifeLook: { confidence: 1, warnings: [], data: { description: 'professional architectural photography' } },
    constraints: { confidence: 1, warnings: [], data: { notedUncertainties: [] } },
  },
} as unknown as StructuredIntelligence;

function makeContext(enabledLocks: QcNormalizedRequestContext['enabledLocks']): QcNormalizedRequestContext {
  return {
    structuredIntelligence,
    projectDNA: {
      architectureDNA: null,
      interiorDNA: null,
      cameraDNA: { height: 1.6, lens: 'wide', fieldOfView: 60, perspective: 'eye-level', eyeLevel: 'standing', projection: 'perspective', verticalCorrection: 'none' },
      materialDNA: { assignments: {} },
      lightingDNA: { direction: 'front', timeOfDay: 'day', intensity: 'bright', softness: 'soft', colorTemperature: 'neutral', artificialLighting: [] },
      environmentDNA: { setting: 'suburban', sky: 'clear', weather: 'sunny', context: 'yard' },
      referenceDNA: null,
    },
    enabledLocks,
    resolvedStyle: 'Modern',
    instructions: [],
  };
}

function mockScoresResponse(scores: QCScores, issues: unknown[] = [], correctionInstruction: string | null = null) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ output_text: JSON.stringify({ scores, issues, correctionInstruction }) }),
  };
}

describe('computeQcDecision', () => {
  const perfectScores: QCScores = {
    architectureScore: 1,
    cameraScore: 1,
    materialScore: 1,
    lightingScore: 1,
    objectConsistencyScore: 1,
    photorealismScore: 1,
  };

  it('passes when every score is above threshold', () => {
    expect(computeQcDecision(perfectScores, ['architecture', 'camera', 'material', 'style', 'lighting'] as Lock['id'][])).toBe('pass');
  });

  it('fails when a locked attribute scores below threshold', () => {
    const scores = { ...perfectScores, architectureScore: 0.4 };
    expect(computeQcDecision(scores, ['architecture'] as Lock['id'][])).toBe('fail');
  });

  it('does not fail on a low score for an attribute whose lock is disabled', () => {
    const scores = { ...perfectScores, architectureScore: 0.1 };
    expect(computeQcDecision(scores, [])).toBe('pass');
  });

  it('always enforces objectConsistencyScore and photorealismScore regardless of locks', () => {
    expect(computeQcDecision({ ...perfectScores, objectConsistencyScore: 0.2 }, [])).toBe('fail');
    expect(computeQcDecision({ ...perfectScores, photorealismScore: 0.2 }, [])).toBe('fail');
  });
});

describe('createGeminiQcEngine', () => {
  it('rejects with PROVIDER_NOT_CONFIGURED when no API key is set, without ever calling fetch', async () => {
    const fetchFn = vi.fn();
    const engine = createGeminiQcEngine({ apiKey: undefined, fetchFn });
    await expect(
      engine.evaluate({ sourceAsset, outputAsset, normalizedRequest: makeContext(['architecture']) }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends both source and output images plus the expected structured intent', async () => {
    const perfectScores: QCScores = {
      architectureScore: 1,
      cameraScore: 1,
      materialScore: 1,
      lightingScore: 1,
      objectConsistencyScore: 1,
      photorealismScore: 1,
    };
    const fetchFn = vi.fn().mockResolvedValue(mockScoresResponse(perfectScores));
    const engine = createGeminiQcEngine({ apiKey: 'test-key', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await engine.evaluate({ sourceAsset, outputAsset, normalizedRequest: makeContext(['architecture']) });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body);
    expect(body.input).toHaveLength(3);
    expect(body.input[1].mime_type).toBe('image/png');
    expect(body.input[2].mime_type).toBe('image/png');
    expect(body.input[0].text).toContain('architecture');

    expect(result.decision).toBe('pass');
    expect(result.correctionInstruction).toBeNull();
  });

  it('fails and returns a correction instruction when a locked attribute scores below threshold', async () => {
    const scores: QCScores = {
      architectureScore: 0.3,
      cameraScore: 1,
      materialScore: 1,
      lightingScore: 1,
      objectConsistencyScore: 1,
      photorealismScore: 1,
    };
    const issues = [{ attribute: 'architecture', severity: 'high', description: 'roofline changed' }];
    const fetchFn = vi.fn().mockResolvedValue(mockScoresResponse(scores, issues, 'Regenerate preserving the original roofline.'));
    const engine = createGeminiQcEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await engine.evaluate({ sourceAsset, outputAsset, normalizedRequest: makeContext(['architecture']) });

    expect(result.decision).toBe('fail');
    expect(result.issues).toHaveLength(1);
    expect(result.correctionInstruction).toBe('Regenerate preserving the original roofline.');
  });

  it('synthesizes a fallback correction instruction when the model omits one on a fail', async () => {
    const scores: QCScores = {
      architectureScore: 0.3,
      cameraScore: 1,
      materialScore: 1,
      lightingScore: 1,
      objectConsistencyScore: 1,
      photorealismScore: 1,
    };
    const issues = [{ attribute: 'architecture', severity: 'high', description: 'roofline changed' }];
    const fetchFn = vi.fn().mockResolvedValue(mockScoresResponse(scores, issues, null));
    const engine = createGeminiQcEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await engine.evaluate({ sourceAsset, outputAsset, normalizedRequest: makeContext(['architecture']) });

    expect(result.decision).toBe('fail');
    expect(result.correctionInstruction).toContain('architecture');
  });

  it('classifies a 429 rate-limit response as retryable, with the QC-specific error code', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'quota exceeded' });
    const engine = createGeminiQcEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(
      engine.evaluate({ sourceAsset, outputAsset, normalizedRequest: makeContext([]) }),
    ).rejects.toMatchObject({ code: 'QC_PROVIDER_ERROR', retryable: true });
  });

  it('classifies a 400 client error as not retryable', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request', text: async () => 'bad input' });
    const engine = createGeminiQcEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(
      engine.evaluate({ sourceAsset, outputAsset, normalizedRequest: makeContext([]) }),
    ).rejects.toMatchObject({ code: 'QC_PROVIDER_ERROR', retryable: false });
  });

  it('rejects when the model returns output_text that is not valid JSON', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ output_text: 'not json' }) });
    const engine = createGeminiQcEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(
      engine.evaluate({ sourceAsset, outputAsset, normalizedRequest: makeContext([]) }),
    ).rejects.toMatchObject({ code: 'QC_PROVIDER_ERROR' });
  });

  it('rejects when the model output does not match the required structure', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ output_text: JSON.stringify({ nope: true }) }) });
    const engine = createGeminiQcEngine({ apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(
      engine.evaluate({ sourceAsset, outputAsset, normalizedRequest: makeContext([]) }),
    ).rejects.toMatchObject({ code: 'QC_PROVIDER_ERROR' });
  });
});
