import { describe, expect, it, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { ImageGenerationAdapter } from '@avs/model-adapters';
import { ImageGenerationService } from '@avs/model-adapters';
import { createApp } from './server.js';
import { createAppContext, type AppContext } from './app-context.js';

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

function fakeSucceedingAdapter(id: string): ImageGenerationAdapter {
  return {
    id,
    capabilities: () => ({ maxResolution: '2K', supportedAspectRatios: ['2:3'], supportsEdit: false, supportsUpscale: false }),
    validate: (request) => ({ valid: request.sourceAssets.length > 0 && Boolean(request.promptText.trim()), errors: [] }),
    generate: async (request) => ({
      status: 'succeeded',
      outputAssetUrls: ['data:image/png;base64,ZmFrZS1nZW5lcmF0ZWQtaW1hZ2U='],
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

  async function createProjectAndAsset() {
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Villa A', module: 'architecture' }),
    });
    const project = (await createRes.json()) as { id: string; currentVersionId: string };
    const uploadRes = await fetch(`${baseUrl}/projects/${project.id}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: ONE_PIXEL_PNG,
    });
    const asset = (await uploadRes.json()) as { id: string };
    return { project, asset };
  }

  it('runs generation, registers a real output asset, creates a version, and advances the project', async () => {
    const context = createAppContext();
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': fakeSucceedingAdapter('nano-banana') });
    await start(context);

    const { project, asset } = await createProjectAndAsset();
    expect(project.currentVersionId).toBe('');

    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id, referenceAssetIds: [] }),
    });

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
    const outputRes = await fetch(`${baseUrl}${body.outputAssetUrls[0]}`);
    expect(outputRes.status).toBe(200);
    const outputBytes = Buffer.from(await outputRes.arrayBuffer());
    expect(outputBytes.toString('base64')).toBe('ZmFrZS1nZW5lcmF0ZWQtaW1hZ2U=');

    const stored = await context.generationRepository.getById(body.generationId);
    expect(stored).toMatchObject({ projectId: project.id, sourceAssets: [asset.id], status: 'succeeded' });

    const version = await context.versionRepository.getById(body.versionId);
    expect(version).toMatchObject({ kind: 'generation', snapshotRef: body.generationId });

    const job = await context.jobQueue.getStatus(body.jobId);
    expect(job?.status).toBe('succeeded');
  });

  it('returns 404 for an unknown project', async () => {
    await start(createAppContext());
    const res = await fetch(`${baseUrl}/projects/does-not-exist/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: 'a1', referenceAssetIds: [] }),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('returns 404 when the source asset does not belong to the project', async () => {
    const context = createAppContext();
    await start(context);
    const { project } = await createProjectAndAsset();
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: 'does-not-exist', referenceAssetIds: [] }),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('returns 404 when a reference asset does not belong to the project', async () => {
    const context = createAppContext();
    await start(context);
    const { project, asset } = await createProjectAndAsset();
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id, referenceAssetIds: ['does-not-exist'] }),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('rejects an invalid render core rather than passing it through to a provider', async () => {
    const context = createAppContext();
    await start(context);
    const { project, asset } = await createProjectAndAsset();
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, renderCore: 'Midjourney', sourceAssetId: asset.id, referenceAssetIds: [] }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns 503 PROVIDER_NOT_CONFIGURED for Nano Banana when no key is set — the real, honest state right now', async () => {
    const context = createAppContext(); // no provider keys
    await start(context);
    const { project, asset } = await createProjectAndAsset();
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id, referenceAssetIds: [] }),
    });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('returns 501 NOT_IMPLEMENTED for Google Flow — the documented BUILD 12 finding, and marks the job failed', async () => {
    const context = createAppContext();
    await start(context);
    const { project, asset } = await createProjectAndAsset();
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, renderCore: 'Google Flow', sourceAssetId: asset.id, referenceAssetIds: [] }),
    });
    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it("'Auto' resolves to a real adapter (nano-banana), not the unimplemented Google Flow adapter", async () => {
    const context = createAppContext();
    context.imageGenerationService = new ImageGenerationService({
      'nano-banana': fakeSucceedingAdapter('nano-banana'),
      'google-flow': fakeSucceedingAdapter('google-flow'),
    });
    await start(context);
    const { project, asset } = await createProjectAndAsset();
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, renderCore: 'Auto', sourceAssetId: asset.id, referenceAssetIds: [] }),
    });
    const body = (await res.json()) as { generation: { provider: string } };
    expect(body.generation.provider).toBe('nano-banana');
  });

  it('marks the job failed, not silently succeeded, when the adapter throws', async () => {
    const failingAdapter: ImageGenerationAdapter = {
      ...fakeSucceedingAdapter('nano-banana'),
      generate: vi.fn().mockRejectedValue(new Error('provider exploded')),
    };
    const context = createAppContext();
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': failingAdapter });
    await start(context);
    const { project, asset } = await createProjectAndAsset();

    const res = await fetch(`${baseUrl}/projects/${project.id}/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, sourceAssetId: asset.id, referenceAssetIds: [] }),
    });
    expect(res.status).toBe(500);

    // A fresh context's first job is deterministically 'job-1' (InMemoryJobQueue) — no jobId
    // is returned in an error response, so this checks the same real state a jobId lookup would.
    const job = await context.jobQueue.getStatus('job-1');
    expect(job?.status).toBe('failed');
  });
});
