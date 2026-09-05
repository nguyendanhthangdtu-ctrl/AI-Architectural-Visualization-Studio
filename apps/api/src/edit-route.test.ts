import { describe, expect, it, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { ImageGenerationAdapter } from '@avs/model-adapters';
import { ImageGenerationService } from '@avs/model-adapters';
import { createApp } from './server.js';
import { createAppContext, type AppContext } from './app-context.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const VALID_EDIT_BODY = {
  targetRegionDescription: 'the facade material',
  intendedChange: 'replace with warm wood cladding',
  category: 'material-replacement' as const,
  protectedLocks: ['architecture', 'camera'] as const,
  aspectRatio: '2:3',
  resolution: '2K',
};

function editCapableAdapter(id: string, captured?: { lastPromptText?: string }): ImageGenerationAdapter {
  return {
    id,
    capabilities: () => ({ maxResolution: '2K', supportedAspectRatios: ['2:3'], supportsEdit: true, supportsUpscale: false }),
    validate: () => ({ valid: true, errors: [] }),
    generate: async () => ({
      status: 'succeeded',
      outputAssetUrls: ['data:image/png;base64,ZmFrZS1nZW5lcmF0ZWQ='],
      usageMetadata: { adapter: id, model: 'fake-model' },
    }),
    edit: async (request) => {
      if (captured) captured.lastPromptText = request.promptText;
      return {
        status: 'succeeded',
        outputAssetUrls: ['data:image/png;base64,ZWRpdGVkLW91dHB1dA=='],
        usageMetadata: { adapter: id, model: 'fake-edit-model' },
      };
    },
    normalizeError: (e) => ({ code: 'FAKE_ERROR', message: String(e), retryable: false }),
  };
}

function noEditAdapter(id: string): ImageGenerationAdapter {
  return {
    id,
    capabilities: () => ({ maxResolution: '2K', supportedAspectRatios: ['2:3'], supportsEdit: false, supportsUpscale: false }),
    validate: () => ({ valid: true, errors: [] }),
    generate: async () => ({
      status: 'succeeded',
      outputAssetUrls: ['data:image/png;base64,ZmFrZS1nZW5lcmF0ZWQ='],
      usageMetadata: { adapter: id, model: 'fake-model' },
    }),
    normalizeError: (e) => ({ code: 'FAKE_ERROR', message: String(e), retryable: false }),
  };
}

describe('apps/api edit route (BUILD 14 Advanced Image Editor)', () => {
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

  async function createProjectAssetAndGeneration() {
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
    return { project, asset, generationId: gen.generationId, outputAssetUrl: gen.outputAssetUrls[0]! };
  }

  it('edits the generation output, registers a real output asset, and creates a kind:"edit" version', async () => {
    const captured: { lastPromptText?: string } = {};
    const context = createAppContext();
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': editCapableAdapter('nano-banana', captured) });
    await start(context);

    const { project, generationId, outputAssetUrl } = await createProjectAssetAndGeneration();
    const outputAssetId = outputAssetUrl.split('/').pop()!;

    const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/edits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_EDIT_BODY, sourceAssetId: outputAssetId }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      editId: string;
      versionId: string;
      project: { currentVersionId: string };
      edit: { status: string; category: string; parentGenerationId: string };
      outputAssetUrls: string[];
    };
    expect(body.edit.status).toBe('succeeded');
    expect(body.edit.category).toBe('material-replacement');
    expect(body.edit.parentGenerationId).toBe(generationId);
    expect(body.project.currentVersionId).toBe(body.versionId);

    const version = await context.versionRepository.getById(body.versionId);
    expect(version).toMatchObject({ kind: 'edit', snapshotRef: body.editId });

    const stored = await context.editRepository.getById(body.editId);
    expect(stored).toMatchObject({
      targetRegionDescription: 'the facade material',
      intendedChange: 'replace with warm wood cladding',
      protectedLocks: ['architecture', 'camera'],
    });

    // Real output asset — fetchable, decoded from the adapter's data: URI, not echoed back verbatim.
    const outputRes = await fetch(`${baseUrl}${body.outputAssetUrls[0]}`);
    expect(Buffer.from(await outputRes.arrayBuffer()).toString('base64')).toBe('ZWRpdGVkLW91dHB1dA==');

    // The composed instruction real carries the declared region/change/protected-locks (docs/12).
    expect(captured.lastPromptText).toContain('the facade material');
    expect(captured.lastPromptText).toContain('replace with warm wood cladding');
    expect(captured.lastPromptText).toContain('architecture, camera');
  });

  it('returns 404 for an unknown project', async () => {
    await start(createAppContext());
    const res = await fetch(`${baseUrl}/projects/does-not-exist/generations/g1/edits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_EDIT_BODY, sourceAssetId: 'a1' }),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('returns 404 for an unknown parent generation', async () => {
    const context = createAppContext();
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': editCapableAdapter('nano-banana') });
    await start(context);
    const { project, asset } = await createProjectAssetAndGeneration();
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations/does-not-exist/edits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_EDIT_BODY, sourceAssetId: asset.id }),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'GENERATION_NOT_FOUND' });
  });

  it('returns 404 when the source asset does not belong to the project', async () => {
    const context = createAppContext();
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': editCapableAdapter('nano-banana') });
    await start(context);
    const { project, generationId } = await createProjectAssetAndGeneration();
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/edits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_EDIT_BODY, sourceAssetId: 'does-not-exist' }),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('returns 404 when the mask asset does not belong to the project', async () => {
    const context = createAppContext();
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': editCapableAdapter('nano-banana') });
    await start(context);
    const { project, generationId, outputAssetUrl } = await createProjectAssetAndGeneration();
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/edits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...VALID_EDIT_BODY,
        sourceAssetId: outputAssetUrl.split('/').pop(),
        maskAssetId: 'does-not-exist',
      }),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('rejects an invalid category rather than passing it through to the provider', async () => {
    const context = createAppContext();
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': editCapableAdapter('nano-banana') });
    await start(context);
    const { project, generationId, asset } = await createProjectAssetAndGeneration();
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/edits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_EDIT_BODY, category: 'sky-replacement', sourceAssetId: asset.id }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it("returns 501 EDIT_NOT_SUPPORTED when the parent generation's adapter has no edit(), never silently falling back to generate()", async () => {
    const context = createAppContext();
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': noEditAdapter('nano-banana') });
    await start(context);
    const { project, generationId, outputAssetUrl } = await createProjectAssetAndGeneration();
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/edits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_EDIT_BODY, sourceAssetId: outputAssetUrl.split('/').pop() }),
    });
    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toMatchObject({ code: 'EDIT_NOT_SUPPORTED' });
  });

  it('reuses the parent generation’s own provider, never a different adapter', async () => {
    const nanoCaptured: { lastPromptText?: string } = {};
    const context = createAppContext();
    context.imageGenerationService = new ImageGenerationService({
      'nano-banana': editCapableAdapter('nano-banana', nanoCaptured),
      'chatgpt-image': editCapableAdapter('chatgpt-image'),
    });
    await start(context);
    const { project, generationId, outputAssetUrl } = await createProjectAssetAndGeneration();
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/edits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_EDIT_BODY, sourceAssetId: outputAssetUrl.split('/').pop() }),
    });
    const body = (await res.json()) as { edit: { usageMetadata: { adapter: string } } };
    expect(body.edit.usageMetadata['adapter']).toBe('nano-banana');
    expect(nanoCaptured.lastPromptText).toBeDefined();
  });
});
