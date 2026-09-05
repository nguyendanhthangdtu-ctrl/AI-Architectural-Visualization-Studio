import { describe, expect, it, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { AssetId } from '@avs/shared';
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
  promptText: 'A modern villa at golden hour, photorealistic',
  renderCore: 'Nano Banana' as const,
  aspectRatio: '2:3',
  resolution: '2K',
  promptVersion: 'prompt-compiler:v1',
  scenarioVersion: '2026-09-04T00:00:00.000Z',
};

function fakeAdapterReturning(id: string, outputAssetUrls: string[]): ImageGenerationAdapter {
  return {
    id,
    capabilities: () => ({ maxResolution: '2K', supportedAspectRatios: ['2:3'], supportsEdit: false, supportsUpscale: false }),
    validate: (request) => ({ valid: request.sourceAssets.length > 0 && Boolean(request.promptText.trim()), errors: [] }),
    generate: async (request) => ({
      status: 'succeeded',
      outputAssetUrls,
      usageMetadata: { adapter: id, model: 'fake-model', requestId: request.requestId },
      providerJobId: 'fake-job-1',
    }),
    normalizeError: (e) => ({ code: 'FAKE_ERROR', message: String(e), retryable: false }),
  };
}

function fakeSucceedingAdapter(id: string): ImageGenerationAdapter {
  return {
    id,
    capabilities: () => ({ maxResolution: '2K', supportedAspectRatios: ['2:3'], supportsEdit: false, supportsUpscale: false }),
    validate: (request) => ({ valid: request.sourceAssets.length > 0 && Boolean(request.promptText.trim()), errors: [] }),
    generate: async (request) => ({
      status: 'succeeded',
      // BUILD 21: a real, valid 1x1 PNG — output validation (routes.ts's
      // decodeDataUri) now requires a genuinely decodable image, not an
      // arbitrary placeholder string, so the fixture must be real too.
      outputAssetUrls: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
      usageMetadata: { adapter: id, model: 'fake-model', requestId: request.requestId },
      providerJobId: 'fake-job-1',
    }),
    normalizeError: (e) => ({ code: 'FAKE_ERROR', message: String(e), retryable: false }),
  };
}

describe('apps/api generation route (BUILD 13 Image Generation Pipeline)', () => {
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

  it('runs generation, registers a real output asset, creates a version, and advances the project', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': fakeSucceedingAdapter('nano-banana') });
    await start(context);
    const session = await registerTestUser(baseUrl);

    const { project, asset } = await createProjectAndAsset(session);
    expect(project.currentVersionId).toBe('');

    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id, referenceAssetIds: [] }),
    }, session.cookie));

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      jobId: string;
      generationId: string;
      versionId: string;
      project: { currentVersionId: string };
      generation: { status: string; provider: string; outputAssets: string[] };
      outputAssetUrls: string[];
    };
    expect(body.generation.status).toBe('succeeded');
    expect(body.generation.provider).toBe('nano-banana');
    expect(body.project.currentVersionId).toBe(body.versionId);
    expect(body.outputAssetUrls).toHaveLength(1);

    // The output asset is real and fetchable — the data: URI was actually decoded and stored, not just echoed back.
    const outputRes = await fetch(`${baseUrl}${body.outputAssetUrls[0]}`, withCookie({}, session.cookie));
    expect(outputRes.status).toBe(200);
    const outputBytes = Buffer.from(await outputRes.arrayBuffer());
    expect(outputBytes.toString('base64')).toBe('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');

    const stored = await context.generationRepository.getById(body.generationId);
    expect(stored).toMatchObject({ projectId: project.id, sourceAssets: [asset.id], status: 'succeeded' });

    const version = await context.versionRepository.getById(body.versionId);
    expect(version).toMatchObject({ kind: 'generation', snapshotRef: body.generationId });

    const job = await context.jobQueue.getStatus(body.jobId);
    expect(job?.status).toBe('succeeded');
  });

  it('BUILD 21: an Idempotency-Key header prevents a client retry from calling the provider twice', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    const realAdapter = fakeSucceedingAdapter('nano-banana');
    const generateSpy = vi.fn(realAdapter.generate);
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': { ...realAdapter, generate: generateSpy } });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);

    const requestInit = withCookie(
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'retry-test-key-1' },
        body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id, referenceAssetIds: [] }),
      },
      session.cookie,
    );

    const first = await fetch(`${baseUrl}/projects/${project.id}/generations`, requestInit);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { outputAssetUrls: string[]; generationId: string };

    // Simulates the client never seeing the first response (e.g. a dropped
    // connection) and retrying with the exact same key.
    const second = await fetch(`${baseUrl}/projects/${project.id}/generations`, requestInit);
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { outputAssetUrls: string[]; generationId: string };

    expect(generateSpy).toHaveBeenCalledTimes(1); // the real, cost-bearing call happened exactly once
    expect(secondBody.outputAssetUrls).toEqual(firstBody.outputAssetUrls); // same already-persisted output asset reused
    expect(secondBody.generationId).not.toBe(firstBody.generationId); // still a distinct, real GenerationRecord per HTTP call
  });

  it('BUILD 21: two concurrent requests with the same Idempotency-Key never both call the provider', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    let releaseGenerate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGenerate = resolve;
    });
    const realAdapter = fakeSucceedingAdapter('nano-banana');
    const generateSpy = vi.fn(async (request: Parameters<typeof realAdapter.generate>[0]) => {
      await gate;
      return realAdapter.generate(request);
    });
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': { ...realAdapter, generate: generateSpy } });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);

    const requestInit = withCookie(
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'concurrent-test-key-1' },
        body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id, referenceAssetIds: [] }),
      },
      session.cookie,
    );

    const firstPromise = fetch(`${baseUrl}/projects/${project.id}/generations`, requestInit);
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the first request actually enqueue+start running
    const second = await fetch(`${baseUrl}/projects/${project.id}/generations`, requestInit);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ code: 'GENERATION_IN_PROGRESS' });

    releaseGenerate?.();
    const first = await firstPromise;
    expect(first.status).toBe(201);
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  it('BUILD 21 Phase 4: rejects a provider response that is not real, decodable image data — never persists it as a bogus asset', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.imageGenerationService = new ImageGenerationService({
      'nano-banana': fakeAdapterReturning('nano-banana', ['data:image/png;base64,dGhpcyBpcyBub3QgYSByZWFsIHBuZw==']), // "this is not a real png"
    });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);

    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id, referenceAssetIds: [] }),
    }, session.cookie));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ code: 'GENERATION_OUTPUT_INVALID' });
  });

  it('BUILD 21 Phase 4: rejects an empty provider output payload', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.imageGenerationService = new ImageGenerationService({
      'nano-banana': fakeAdapterReturning('nano-banana', ['data:image/png;base64,']),
    });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);

    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id, referenceAssetIds: [] }),
    }, session.cookie));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ code: 'GENERATION_OUTPUT_INVALID' });

    // BUILD 23 — this was a real bug: the job used to stay stuck 'running'
    // forever when output validation failed, permanently blocking any
    // future retry of this exact idempotency key.
    const job = await context.jobQueue.getStatus('job-1');
    expect(job?.status).toBe('failed');
  });

  it('BUILD 23: marks the job failed (not stuck running) when AssetStore.put() itself fails, not just when the provider fails', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': fakeSucceedingAdapter('nano-banana') });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session); // real upload succeeds — put() only starts failing below

    context.assetStore.put = async () => {
      throw new Error('simulated disk failure');
    };

    const requestInit = withCookie(
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'asset-failure-retry-key' },
        body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id, referenceAssetIds: [] }),
      },
      session.cookie,
    );

    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, requestInit);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ code: 'ASSET_STORE_ERROR' });

    const job = await context.jobQueue.getStatus('job-1');
    expect(job?.status).toBe('failed'); // not stuck 'running'

    // And this exact same idempotency key can be retried afterward — not
    // permanently blocked by a job that never recovered from 'running'.
    context.assetStore.put = async (params) => ({
      id: 'recovered-asset' as AssetId,
      projectId: params.projectId,
      url: '/assets/recovered-asset',
      contentType: params.contentType,
      sizeBytes: params.data.length,
    });
    const retryRes = await fetch(`${baseUrl}/projects/${project.id}/generations`, requestInit);
    expect(retryRes.status).toBe(201);
  });

  it('returns 404 for an unknown project', async () => {
    await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
    const session = await registerTestUser(baseUrl);
    const res = await fetch(`${baseUrl}/projects/does-not-exist/generations`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: 'a1', referenceAssetIds: [] }),
    }, session.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('returns 404 when the source asset does not belong to the project', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: 'does-not-exist', referenceAssetIds: [] }),
    }, session.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('returns 404 when a reference asset does not belong to the project', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id, referenceAssetIds: ['does-not-exist'] }),
    }, session.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('rejects an invalid render core rather than passing it through to a provider', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, renderCore: 'Midjourney', sourceAssetId: asset.id, referenceAssetIds: [] }),
    }, session.cookie));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns 503 PROVIDER_NOT_CONFIGURED for Nano Banana when no key is set — the real, honest state right now', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }); // no provider keys
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id, referenceAssetIds: [] }),
    }, session.cookie));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('BUILD 27: returns 503 PROVIDER_NOT_CONFIGURED for Nano Banana Pro when no key is set — same shared credential, same honest state', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }); // no provider keys
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, renderCore: 'Nano Banana Pro', sourceAssetId: asset.id, referenceAssetIds: [] }),
    }, session.cookie));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('returns 501 NOT_IMPLEMENTED for Google Flow — the documented BUILD 12 finding, and marks the job failed', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, renderCore: 'Google Flow', sourceAssetId: asset.id, referenceAssetIds: [] }),
    }, session.cookie));
    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('BUILD 27 FIX: rejects "Auto" as an invalid renderCore — the AI Image Model selector no longer offers or accepts it', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, renderCore: 'Auto', sourceAssetId: asset.id, referenceAssetIds: [] }),
    }, session.cookie));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('marks the job failed, not silently succeeded, when the adapter throws', async () => {
    const failingAdapter: ImageGenerationAdapter = {
      ...fakeSucceedingAdapter('nano-banana'),
      generate: vi.fn().mockRejectedValue(new Error('provider exploded')),
    };
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': failingAdapter });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);

    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id, referenceAssetIds: [] }),
    }, session.cookie));
    expect(res.status).toBe(500);

    // A fresh context's first job is deterministically 'job-1' (InMemoryJobQueue) — no jobId
    // is returned in an error response, so this checks the same real state a jobId lookup would.
    const job = await context.jobQueue.getStatus('job-1');
    expect(job?.status).toBe('failed');
  });
});
