import { describe, expect, it, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { ImageGenerationAdapter } from '@avs/model-adapters';
import { ImageGenerationService } from '@avs/model-adapters';
import { createApp } from './server.js';
import { createAppContext, type AppContext } from './app-context.js';
import { registerTestUser, TEST_REGISTRATION_SECRET, withCookie, type TestSession } from './test-helpers/auth.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const VALID_BODY = {
  promptText: 'A modern villa, bird’s eye view, photorealistic',
  renderCore: 'Nano Banana' as const,
  aspectRatio: '2:3',
  resolution: '2K',
  promptVersion: 'prompt-compiler:v1',
  scenarioVersion: '2026-09-04T00:00:00.000Z',
  referenceAssetIds: [] as string[],
  mode: 'sync' as const,
  cameraProposal: { perspective: 'bird’s eye' },
  ignoredProposals: [] as string[],
};

function fakeSucceedingAdapter(id: string): ImageGenerationAdapter {
  return {
    id,
    capabilities: () => ({ maxResolution: '2K', supportedAspectRatios: ['2:3'], supportsEdit: false, supportsUpscale: false }),
    validate: (request) => ({ valid: request.sourceAssets.length > 0 && Boolean(request.promptText.trim()), errors: [] }),
    generate: async (request) => ({
      status: 'succeeded',
      outputAssetUrls: ['data:image/png;base64,ZmFrZS12aWV3LWltYWdl'],
      usageMetadata: { adapter: id, model: 'fake-model', requestId: request.requestId },
    }),
    normalizeError: (e) => ({ code: 'FAKE_ERROR', message: String(e), retryable: false }),
  };
}

describe('apps/api view route (BUILD 15 Multi-View / Sync / Creative View)', () => {
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

  async function createProjectAndAsset(session: TestSession) {
    const createRes = await fetch(`${baseUrl}/projects`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Villa A', module: 'architecture' }),
    }, session.cookie));
    const project = (await createRes.json()) as { id: string; currentVersionId: string };
    const uploadRes = await fetch(`${baseUrl}/projects/${project.id}/assets`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: ONE_PIXEL_PNG,
    }, session.cookie));
    const asset = (await uploadRes.json()) as { id: string };
    return { project, asset };
  }

  it('runs a Sync View, persists a real ViewRecord, links GenerationRecord.viewId, and creates a kind:"view" version', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': fakeSucceedingAdapter('nano-banana') });
    await start(context);
    const session = await registerTestUser(baseUrl);

    const { project, asset } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/views`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id }),
    }, session.cookie));

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      viewId: string;
      generationId: string;
      versionId: string;
      project: { currentVersionId: string };
      view: { mode: string; cameraProposal: unknown };
      generation: { viewId: string | null; status: string };
      outputAssetUrls: string[];
    };
    expect(body.view.mode).toBe('sync');
    expect(body.view.cameraProposal).toEqual({ perspective: 'bird’s eye' });
    expect(body.generation.viewId).toBe(body.viewId); // GenerationRecord.viewId, scaffolded since BUILD 02, populated for real here
    expect(body.generation.status).toBe('succeeded');
    expect(body.project.currentVersionId).toBe(body.versionId);

    const version = await context.versionRepository.getById(body.versionId);
    expect(version).toMatchObject({ kind: 'view', snapshotRef: body.generationId });

    const storedView = await context.viewRepository.getById(body.viewId);
    expect(storedView).toMatchObject({ mode: 'sync', resultingGenerationId: body.generationId });

    const outputRes = await fetch(`${baseUrl}${body.outputAssetUrls[0]}`, withCookie({}, session.cookie));
    expect(Buffer.from(await outputRes.arrayBuffer()).toString('base64')).toBe('ZmFrZS12aWV3LWltYWdl');
  });

  it('runs a Creative View with material/lighting/style proposals recorded verbatim', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': fakeSucceedingAdapter('nano-banana') });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);

    const res = await fetch(`${baseUrl}/projects/${project.id}/views`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...VALID_BODY,
        sourceAssetId: asset.id,
        mode: 'creative',
        materialProposal: { assignments: { wall: { type: 'wood', finish: 'matte', roughness: 'high', reflectance: 'low' } } },
        lightingProposal: { timeOfDay: 'sunset' },
        styleProposal: 'Industrial',
      }),
    }, session.cookie));

    const body = (await res.json()) as {
      view: { mode: string; materialProposal: unknown; lightingProposal: unknown; styleProposal: string };
    };
    expect(body.view.mode).toBe('creative');
    expect(body.view.materialProposal).toEqual({ assignments: { wall: { type: 'wood', finish: 'matte', roughness: 'high', reflectance: 'low' } } });
    expect(body.view.lightingProposal).toEqual({ timeOfDay: 'sunset' });
    expect(body.view.styleProposal).toBe('Industrial');
  });

  it('records ignoredProposals for real provenance when a Sync View had a proposal structurally ignored client-side', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': fakeSucceedingAdapter('nano-banana') });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);

    const res = await fetch(`${baseUrl}/projects/${project.id}/views`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id, ignoredProposals: ['material', 'style'] }),
    }, session.cookie));
    const body = (await res.json()) as { view: { ignoredProposals: string[] } };
    expect(body.view.ignoredProposals).toEqual(['material', 'style']);
  });

  it('returns 404 for an unknown project', async () => {
    await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
    const session = await registerTestUser(baseUrl);
    const res = await fetch(`${baseUrl}/projects/does-not-exist/views`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: 'a1' }),
    }, session.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('returns 404 when the source asset does not belong to the project', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': fakeSucceedingAdapter('nano-banana') });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/views`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: 'does-not-exist' }),
    }, session.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('rejects an invalid mode rather than passing it through', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/views`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, mode: 'freeform', sourceAssetId: asset.id }),
    }, session.cookie));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns 503 PROVIDER_NOT_CONFIGURED when no key is set — the real, honest state right now', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }); // no provider keys
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/views`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id }),
    }, session.cookie));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });
});
