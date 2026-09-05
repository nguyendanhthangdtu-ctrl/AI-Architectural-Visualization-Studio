import { describe, expect, it, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { AiQc, VisionAnalysisEngine } from '@avs/ai-core';
import { createMockImageAdapter, ImageGenerationService } from '@avs/model-adapters';
import { createApp } from './server.js';
import { createAppContext, type AppContext } from './app-context.js';
import { registerTestUser, TEST_REGISTRATION_SECRET, withCookie, type TestSession } from './test-helpers/auth.js';

/**
 * BUILD 25 (Multi-Model Image Engine / Nano Banana 2) Mock E2E — Part 14-G.
 * Exercises the REAL production pipeline end-to-end
 * (auth → project → real asset upload → analysis → generation → QC → real
 * AssetStore → real signed URL → real round-trip retrieval), through the
 * real `apps/api` HTTP routes, with ONLY the three real-network boundaries
 * (Vision Analysis, Nano Banana 2 generation, AI QC) replaced by fakes —
 * `createMockImageAdapter()` (`@avs/model-adapters`, new, shared, reused
 * rather than a fourth inline `fakeAdapter()`) for generation specifically.
 *
 * Zero network calls. Runs in normal CI — no `NANO_BANANA_API_KEY` and no
 * `RUN_LIVE_PROVIDER_SMOKE_TEST` gate required, unlike
 * `live-provider-smoke.test.ts`. This is the free, always-on proof the
 * pipeline itself is wired correctly; it is never evidence a real provider
 * call works — that is `live-provider-smoke.test.ts`'s job alone.
 */
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
      data: { geometry: 'boxy', openings: 'large windows', roof: 'flat', facade: 'concrete', floorPlan: 'open', ceiling: 'high', stairs: 'none visible', proportions: 'balanced' },
    },
    style: { confidence: 0.9, warnings: [], data: { style: 'Modern', influences: [] } },
    camera: {
      confidence: 0.9,
      warnings: [],
      data: { heightMeters: 1.6, lens: 'wide', fieldOfViewDegrees: 60, perspective: 'eye-level', eyeLevel: 'standing', projection: 'perspective', verticalCorrection: 'none' },
    },
    material: { confidence: 0.9, warnings: [], data: { materials: [] } },
    lighting: {
      confidence: 0.9,
      warnings: [],
      data: { direction: 'front', timeOfDay: 'day', intensity: 'bright', softness: 'soft', shadows: 'soft', colorTemperature: 'neutral', artificialLighting: [] },
    },
    environment: { confidence: 0.9, warnings: [], data: { setting: 'suburban', sky: 'clear', weather: 'sunny', context: 'yard' } },
    object: { confidence: 0.9, warnings: [], data: { objects: [] } },
  },
};

const PERFECT_QC_RESULT = {
  decision: 'pass' as const,
  scores: { architectureScore: 1, cameraScore: 1, materialScore: 1, lightingScore: 1, objectConsistencyScore: 1, photorealismScore: 1 },
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

describe('Mock E2E — Nano Banana 2 (BUILD 25 Part 14-G)', () => {
  let server: ReturnType<typeof createApp> | undefined;
  let baseUrl = '';

  afterEach(() => {
    server?.close();
  });

  function contextWithMocks(): AppContext {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.visionAnalysisEngine = { analyze: vi.fn().mockResolvedValue(FAKE_STRUCTURED_INTELLIGENCE) } as unknown as VisionAnalysisEngine;
    // The real render-core key ('nano-banana') resolves to the Mock
    // Provider here — this exercises the REAL selection path
    // (RENDER_CORE_SELECTION, ImageGenerationService.resolve) exactly as a
    // real deployment would, only swapping what's behind it.
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': createMockImageAdapter() });
    context.aiQcEngine = { evaluate: vi.fn().mockResolvedValue(PERFECT_QC_RESULT) } as unknown as AiQc;
    return context;
  }

  async function start(context: AppContext) {
    server = createApp(context);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  }

  it('runs SOURCE IMAGE → ANALYSIS → PROMPT ENGINE → NANO BANANA 2 (mock) → OUTPUT VALIDATION → QC → ASSET STORE → SIGNED URL → ROUND-TRIP end to end, with zero network calls', async () => {
    await start(contextWithMocks());
    const session: TestSession = await registerTestUser(baseUrl);

    // PROJECT + SOURCE IMAGE
    const createRes = await fetch(`${baseUrl}/projects`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Mock E2E Villa', module: 'architecture' }),
    }, session.cookie));
    expect(createRes.status).toBe(201);
    const project = (await createRes.json()) as { id: string };

    const uploadRes = await fetch(`${baseUrl}/projects/${project.id}/assets`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: ONE_PIXEL_PNG,
    }, session.cookie));
    expect(uploadRes.status).toBe(201);
    const sourceAsset = (await uploadRes.json()) as { id: string };

    // IMAGE ANALYSIS (mocked — no GEMINI_API_KEY needed)
    const analysisRes = await fetch(`${baseUrl}/projects/${project.id}/analysis`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: sourceAsset.id }),
    }, session.cookie));
    expect(analysisRes.status).toBe(201);
    const analysis = (await analysisRes.json()) as { analysisId: string };

    // PROMPT ENGINE output (already compiled client-side per BUILD 11 — this
    // route never re-derives it) → CAMERA/COMPOSITION LOCK preserved via the
    // exact promptText sent → MODEL SELECTOR (renderCore) → NANO BANANA 2.
    const compiledPromptText =
      'A photorealistic architectural photograph of the source building. Preserve the original architecture exactly. Preserve the exact source camera position, angle, and lens. Real-life photography render look.';

    const genRes = await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        promptText: compiledPromptText,
        renderCore: 'Nano Banana',
        aspectRatio: '16:9',
        resolution: '2K',
        sourceAssetId: sourceAsset.id,
        referenceAssetIds: [],
        promptVersion: 'prompt-compiler:v1',
        scenarioVersion: '2026-09-05T00:00:00.000Z',
      }),
    }, session.cookie));

    expect(genRes.status).toBe(201);
    const generation = (await genRes.json()) as {
      generationId: string;
      outputAssetUrls: string[];
      generation: { provider: string; status: string; usageMetadata: Record<string, unknown> };
    };

    // The Mock Provider was selected THROUGH the real 'Nano Banana' render-core
    // key (RENDER_CORE_SELECTION, ImageGenerationService.resolve) — but its own
    // adapter id ('mock') is what gets recorded as the real GenerationRecord's
    // provider, honestly, exactly so this can never be mistaken for a real
    // 'nano-banana' generation by anyone reading persisted data later.
    expect(generation.generation.provider).toBe('mock');
    expect(generation.generation.status).toBe('succeeded');
    expect(generation.generation.usageMetadata['model']).toBe('gemini-3.1-flash-image');
    expect(generation.generation.usageMetadata['mock']).toBe(true); // never indistinguishable from a real generation

    // OUTPUT VALIDATION already ran server-side (validateImageOutput/decodeDataUri,
    // BUILD 21/23) before this response was ever returned — a corrupt/fake
    // image would have been rejected with GENERATION_OUTPUT_INVALID, not 201.
    expect(generation.outputAssetUrls).toHaveLength(1);

    // QC (mocked engine, real route/version-DAG plumbing)
    const qcRes = await fetch(`${baseUrl}/projects/${project.id}/generations/${generation.generationId}/qc`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ analysisId: analysis.analysisId, locks: FIVE_LOCKS, instructions: [] }),
    }, session.cookie));
    expect(qcRes.status).toBe(200);
    const qcBody = (await qcRes.json()) as { qc: typeof PERFECT_QC_RESULT };
    expect(qcBody.qc.decision).toBe('pass');

    // ASSET STORE + SIGNED URL + ROUND-TRIP — real disk-backed store, real signature.
    const outputUrl = generation.outputAssetUrls[0]!;
    expect(outputUrl).toMatch(/\?exp=\d+&sig=[0-9a-f]+$|^\/assets\/[^/?]+$/); // signed when a signing secret is configured, plain otherwise — both real, never fabricated

    const retrieveRes = await fetch(`${baseUrl}${outputUrl}`, withCookie({}, session.cookie));
    expect(retrieveRes.status).toBe(200);
    expect(retrieveRes.headers.get('content-type')).toBe('image/png');
    const retrievedBytes = Buffer.from(await retrieveRes.arrayBuffer());
    // Round-trip: byte-identical to the Mock Provider's own real PNG fixture.
    expect(retrievedBytes.toString('base64')).toBe('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');

    // Ownership: a second, different account must never reach this asset.
    const otherSession = await registerTestUser(baseUrl, `other-${Date.now()}@example.com`);
    const forbiddenRes = await fetch(`${baseUrl}${outputUrl}`, withCookie({}, otherSession.cookie));
    expect(forbiddenRes.status).toBe(404);
  });

  it('BUILD 27: Mock Mode supports all three real AI Image Models (Nano Banana 2, Nano Banana Pro, ChatGPT Image), each reaching a real, honestly-labeled mock READY output through its own real render-core key', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.visionAnalysisEngine = { analyze: vi.fn().mockResolvedValue(FAKE_STRUCTURED_INTELLIGENCE) } as unknown as VisionAnalysisEngine;
    context.imageGenerationService = new ImageGenerationService({
      'nano-banana': createMockImageAdapter({ modelId: 'gemini-3.1-flash-image' }),
      'nano-banana-pro': createMockImageAdapter({ modelId: 'gemini-3-pro-image' }),
      'chatgpt-image': createMockImageAdapter({ modelId: 'gpt-image-1' }),
    });
    context.aiQcEngine = { evaluate: vi.fn().mockResolvedValue(PERFECT_QC_RESULT) } as unknown as AiQc;
    await start(context);
    const session: TestSession = await registerTestUser(baseUrl);

    const createRes = await fetch(`${baseUrl}/projects`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Mock E2E Multi-Model', module: 'architecture' }),
    }, session.cookie));
    const project = (await createRes.json()) as { id: string };

    const uploadRes = await fetch(`${baseUrl}/projects/${project.id}/assets`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: ONE_PIXEL_PNG,
    }, session.cookie));
    const sourceAsset = (await uploadRes.json()) as { id: string };

    const cases: ['Nano Banana' | 'Nano Banana Pro' | 'ChatGPT Image', string][] = [
      ['Nano Banana', 'gemini-3.1-flash-image'],
      ['Nano Banana Pro', 'gemini-3-pro-image'],
      ['ChatGPT Image', 'gpt-image-1'],
    ];

    for (const [renderCore, expectedModelId] of cases) {
      const genRes = await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          promptText: 'A photorealistic architectural photograph, preserving the original architecture and camera.',
          renderCore,
          aspectRatio: '16:9',
          resolution: '2K',
          sourceAssetId: sourceAsset.id,
          referenceAssetIds: [],
          promptVersion: 'prompt-compiler:v1',
          scenarioVersion: '2026-09-05T00:00:00.000Z',
        }),
      }, session.cookie));

      expect(genRes.status, `renderCore "${renderCore}"`).toBe(201);
      const generation = (await genRes.json()) as {
        outputAssetUrls: string[];
        generation: { status: string; usageMetadata: Record<string, unknown> };
      };
      expect(generation.generation.status).toBe('succeeded');
      expect(generation.generation.usageMetadata['model']).toBe(expectedModelId);
      // Never indistinguishable from a real generation — the same honest labeling BUILD 25 established.
      expect(generation.generation.usageMetadata['mock']).toBe(true);
      expect(generation.generation.usageMetadata['note']).toBe('MOCK — NO REAL API CALL');
      expect(generation.outputAssetUrls).toHaveLength(1);
    }
  });

  it('never calls an external provider host — only this test\'s own local loopback server', async () => {
    const externalUrls: string[] = [];
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((...args: Parameters<typeof fetch>) => {
      const url = String(args[0]);
      if (!url.startsWith(baseUrl)) externalUrls.push(url);
      return realFetch(...args);
    });

    const context = contextWithMocks();
    await start(context);
    const session = await registerTestUser(baseUrl);

    const createRes = await fetch(`${baseUrl}/projects`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Villa B', module: 'architecture' }),
    }, session.cookie));
    const project = (await createRes.json()) as { id: string };
    const uploadRes = await fetch(`${baseUrl}/projects/${project.id}/assets`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: ONE_PIXEL_PNG,
    }, session.cookie));
    const asset = (await uploadRes.json()) as { id: string };

    await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        promptText: 'a modern villa',
        renderCore: 'Nano Banana',
        aspectRatio: '1:1',
        resolution: 'Preview', // BUILD 30 FIX — 'resolution' is the app's own closed vocabulary (SCENARIO_RESOLUTIONS), not a provider-level image_size string; '1K' was never a valid app-level value
        sourceAssetId: asset.id,
        referenceAssetIds: [],
        promptVersion: 'v1',
        scenarioVersion: 'v1',
      }),
    }, session.cookie));

    expect(externalUrls).toEqual([]); // never generativelanguage.googleapis.com, never api.openai.com
    fetchSpy.mockRestore();
  });
});
