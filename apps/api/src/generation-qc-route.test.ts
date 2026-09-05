import { describe, expect, it, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { AiQc, VisionAnalysisEngine } from '@avs/ai-core';
import type { ImageGenerationAdapter } from '@avs/model-adapters';
import { ImageGenerationService } from '@avs/model-adapters';
import { createApp } from './server.js';
import { createAppContext, type AppContext } from './app-context.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const FAKE_STRUCTURED_INTELLIGENCE = {
  analysisVersion: 'gemini:test-model:2026-09-04T00:00:00.000Z',
  module: 'architecture' as const,
  layers: {
    subject: { confidence: 0.9, warnings: [], data: { type: 'building', description: 'test' } },
    architecture: {
      confidence: 0.9,
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
    style: { confidence: 0.9, warnings: [], data: { style: 'Modern', influences: [] } },
    camera: {
      confidence: 0.9,
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
    material: { confidence: 0.9, warnings: [], data: { materials: [] } },
    lighting: {
      confidence: 0.9,
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
    environment: { confidence: 0.9, warnings: [], data: { setting: 'suburban', sky: 'clear', weather: 'sunny', context: 'yard' } },
    object: { confidence: 0.9, warnings: [], data: { objects: [] } },
  },
};

const PERFECT_QC_RESULT = {
  decision: 'pass' as const,
  scores: {
    architectureScore: 1,
    cameraScore: 1,
    materialScore: 1,
    lightingScore: 1,
    objectConsistencyScore: 1,
    photorealismScore: 1,
  },
  issues: [],
  correctionInstruction: null,
};

const FIVE_LOCKS = [
  { id: 'architecture', enabled: true },
  { id: 'camera', enabled: true },
  { id: 'material', enabled: true },
  { id: 'style', enabled: false },
  { id: 'lighting', enabled: false },
];

function fakeAdapter(id: string, outputData = 'ZmFrZS1nZW5lcmF0ZWQ='): ImageGenerationAdapter {
  return {
    id,
    capabilities: () => ({ maxResolution: '2K', supportedAspectRatios: ['2:3'], supportsEdit: false, supportsUpscale: false }),
    validate: () => ({ valid: true, errors: [] }),
    generate: async () => ({
      status: 'succeeded',
      outputAssetUrls: [`data:image/png;base64,${outputData}`],
      usageMetadata: { adapter: id, model: 'fake-model' },
    }),
    normalizeError: (e) => ({ code: 'FAKE_ERROR', message: String(e), retryable: false }),
  };
}

describe('apps/api generation QC + regenerate routes (BUILD 17 AI QC / Auto-Regeneration)', () => {
  let server: ReturnType<typeof createApp> | undefined;
  let baseUrl = '';

  afterEach(() => {
    server?.close();
  });

  async function start(context: AppContext) {
    server = createApp(context);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  }

  async function createProjectAssetAnalysisAndGeneration() {
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Villa A', module: 'architecture' }),
    });
    const project = (await createRes.json()) as { id: string };
    const uploadRes = await fetch(`${baseUrl}/projects/${project.id}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: ONE_PIXEL_PNG,
    });
    const asset = (await uploadRes.json()) as { id: string };

    const analysisRes = await fetch(`${baseUrl}/projects/${project.id}/analysis`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: asset.id }),
    });
    const analysis = (await analysisRes.json()) as { analysisId: string };

    const genRes = await fetch(`${baseUrl}/projects/${project.id}/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        promptText: 'a modern villa',
        renderCore: 'Nano Banana',
        aspectRatio: '2:3',
        resolution: '2K',
        sourceAssetId: asset.id,
        referenceAssetIds: [],
        promptVersion: 'v1',
        scenarioVersion: 'v1',
      }),
    });
    const gen = (await genRes.json()) as { generationId: string; outputAssetUrls: string[] };
    return { project, asset, analysisId: analysis.analysisId, generationId: gen.generationId };
  }

  function contextWithFakes(qcResult: unknown = PERFECT_QC_RESULT) {
    const context = createAppContext();
    context.visionAnalysisEngine = {
      analyze: vi.fn().mockResolvedValue(FAKE_STRUCTURED_INTELLIGENCE),
    } as unknown as VisionAnalysisEngine;
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': fakeAdapter('nano-banana') });
    context.aiQcEngine = { evaluate: vi.fn().mockResolvedValue(qcResult) } as unknown as AiQc;
    return context;
  }

  describe('POST /projects/:id/generations/:id/qc', () => {
    it('evaluates the generation and returns the QC result', async () => {
      const context = contextWithFakes();
      await start(context);
      const { project, analysisId, generationId } = await createProjectAssetAnalysisAndGeneration();

      const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/qc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ analysisId, locks: FIVE_LOCKS, instructions: [] }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { generationId: string; qc: typeof PERFECT_QC_RESULT };
      expect(body.generationId).toBe(generationId);
      expect(body.qc).toEqual(PERFECT_QC_RESULT);

      expect(context.aiQcEngine.evaluate).toHaveBeenCalledTimes(1);
      const call = (context.aiQcEngine.evaluate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(call.normalizedRequest.enabledLocks).toEqual(['architecture', 'camera', 'material']);
      expect(call.normalizedRequest.resolvedStyle).toBe('Modern');
      expect(call.sourceAsset.contentType).toBe('image/png');
      expect(call.outputAsset.contentType).toBe('image/png');
    });

    it('returns 404 for an unknown project', async () => {
      await start(contextWithFakes());
      const res = await fetch(`${baseUrl}/projects/does-not-exist/generations/g1/qc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ analysisId: 'a1', locks: FIVE_LOCKS }),
      });
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    });

    it('returns 404 for an unknown generation', async () => {
      const context = contextWithFakes();
      await start(context);
      const { project, analysisId } = await createProjectAssetAnalysisAndGeneration();
      const res = await fetch(`${baseUrl}/projects/${project.id}/generations/does-not-exist/qc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ analysisId, locks: FIVE_LOCKS }),
      });
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toMatchObject({ code: 'GENERATION_NOT_FOUND' });
    });

    it('returns 404 for an unknown analysis id', async () => {
      const context = contextWithFakes();
      await start(context);
      const { project, generationId } = await createProjectAssetAnalysisAndGeneration();
      const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/qc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ analysisId: 'does-not-exist', locks: FIVE_LOCKS }),
      });
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toMatchObject({ code: 'ANALYSIS_NOT_FOUND' });
    });

    it('rejects a locks array that is not exactly the 5 known locks', async () => {
      const context = contextWithFakes();
      await start(context);
      const { project, analysisId, generationId } = await createProjectAssetAnalysisAndGeneration();
      const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/qc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ analysisId, locks: FIVE_LOCKS.slice(0, 2) }),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  describe('POST /projects/:id/generations/:id/regenerate', () => {
    it('resubmits generation, records correction provenance, and chains a new version', async () => {
      const context = contextWithFakes();
      await start(context);
      const { project, asset, generationId } = await createProjectAssetAnalysisAndGeneration();

      const projectBefore = await context.projectRepository.getById(project.id as never);
      const versionBefore = projectBefore!.currentVersionId;

      const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/regenerate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          promptText: 'a modern villa, preserving the original roofline',
          renderCore: 'Nano Banana',
          aspectRatio: '2:3',
          resolution: '2K',
          sourceAssetId: asset.id,
          referenceAssetIds: [],
          promptVersion: 'v1',
          scenarioVersion: 'v1',
          correctionInstruction: 'Preserve the original roofline exactly.',
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        generationId: string;
        versionId: string;
        project: { currentVersionId: string };
        generation: { usageMetadata: Record<string, unknown> };
      };
      expect(body.generationId).not.toBe(generationId);
      expect(body.project.currentVersionId).toBe(body.versionId);
      expect(body.generation.usageMetadata['regeneratedFromGenerationId']).toBe(generationId);
      expect(body.generation.usageMetadata['correctionInstruction']).toBe('Preserve the original roofline exactly.');

      const version = await context.versionRepository.getById(body.versionId);
      expect(version).toMatchObject({ kind: 'generation', parentVersionId: versionBefore });
    });

    it('returns 404 for an unknown parent generation', async () => {
      const context = contextWithFakes();
      await start(context);
      const { project, asset } = await createProjectAssetAnalysisAndGeneration();
      const res = await fetch(`${baseUrl}/projects/${project.id}/generations/does-not-exist/regenerate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          promptText: 'a modern villa',
          renderCore: 'Nano Banana',
          aspectRatio: '2:3',
          resolution: '2K',
          sourceAssetId: asset.id,
          referenceAssetIds: [],
          promptVersion: 'v1',
          scenarioVersion: 'v1',
          correctionInstruction: 'fix it',
        }),
      });
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toMatchObject({ code: 'GENERATION_NOT_FOUND' });
    });

    it('rejects a regenerate request with an empty correctionInstruction', async () => {
      const context = contextWithFakes();
      await start(context);
      const { project, asset, generationId } = await createProjectAssetAnalysisAndGeneration();
      const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/regenerate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          promptText: 'a modern villa',
          renderCore: 'Nano Banana',
          aspectRatio: '2:3',
          resolution: '2K',
          sourceAssetId: asset.id,
          referenceAssetIds: [],
          promptVersion: 'v1',
          scenarioVersion: 'v1',
          correctionInstruction: '',
        }),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });
});
