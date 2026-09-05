import { describe, expect, it, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { ImageGenerationAdapter, VideoGenerationAdapter } from '@avs/model-adapters';
import { ImageGenerationService, VideoGenerationService } from '@avs/model-adapters';
import { createApp } from './server.js';
import { createAppContext, type AppContext } from './app-context.js';
import { registerTestUser, TEST_REGISTRATION_SECRET, withCookie, type TestSession } from './test-helpers/auth.js';

function fakeNanoBananaAdapter(): ImageGenerationAdapter {
  return {
    id: 'nano-banana',
    capabilities: () => ({ maxResolution: '2K', supportedAspectRatios: ['2:3'], supportsEdit: false, supportsUpscale: false }),
    validate: () => ({ valid: true, errors: [] }),
    generate: async () => ({
      status: 'succeeded',
      outputAssetUrls: ['data:image/png;base64,ZmFrZS1nZW5lcmF0ZWQ='],
      usageMetadata: { adapter: 'nano-banana', model: 'fake-model' },
    }),
    normalizeError: (e) => ({ code: 'FAKE_ERROR', message: String(e), retryable: false }),
  };
}

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const VALID_VIDEO_BODY = {
  promptText: 'slow dolly push-in toward the entrance',
  motionType: 'dolly' as const,
  motionDescription: 'camera dollies slowly toward the front door',
  durationSeconds: 6,
  aspectRatio: '16:9',
  resolution: '1080p',
  renderCore: 'Veo' as const,
};

/** Runs once, then reports `running` forever unless `resolvesTo` is given for a later call. */
function scriptedVeoAdapter(pollSequence: ('running' | 'succeeded' | 'failed')[]): VideoGenerationAdapter {
  let pollCount = 0;
  return {
    id: 'veo',
    capabilities: () => ({ maxDurationSeconds: 8, supportedAspectRatios: ['16:9', '9:16'], supportedResolutions: ['720p', '1080p', '4k'] }),
    validate: () => ({ valid: true, errors: [] }),
    submit: async () => ({ operation: { operationName: 'operations/fake-op-1' } }),
    pollStatus: async () => {
      const status = pollSequence[Math.min(pollCount, pollSequence.length - 1)]!;
      pollCount += 1;
      if (status === 'succeeded') {
        return { status, outputVideoUrl: 'data:video/mp4;base64,ZmFrZS12aWRlby1ieXRlcw==', usageMetadata: { adapter: 'veo' } };
      }
      if (status === 'failed') {
        return { status, usageMetadata: { adapter: 'veo', note: 'simulated provider failure' } };
      }
      return { status, usageMetadata: { adapter: 'veo' } };
    },
    normalizeError: (e) => ({ code: 'FAKE_ERROR', message: String(e), retryable: false }),
  };
}

describe('apps/api video route (BUILD 16 Image → Video)', () => {
  let server: ReturnType<typeof createApp> | undefined;
  let baseUrl = '';

  afterEach(() => {
    server?.close();
  });

  async function start(context: AppContext) {
    // These tests exercise the video route, not image generation — every test
    // needs a working parent generation to attach a video to, so give it a
    // real, working (fake) nano-banana adapter regardless of what the test is
    // asserting about video providers.
    context.imageGenerationService = new ImageGenerationService({ 'nano-banana': fakeNanoBananaAdapter() });
    server = createApp(context);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  }

  async function createProjectAssetAndGeneration(session: TestSession) {
    const createRes = await fetch(`${baseUrl}/projects`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Villa A', module: 'architecture' }),
    }, session.cookie));
    const project = (await createRes.json()) as { id: string };
    const uploadRes = await fetch(`${baseUrl}/projects/${project.id}/assets`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: ONE_PIXEL_PNG,
    }, session.cookie));
    const asset = (await uploadRes.json()) as { id: string };

    const genRes = await fetch(`${baseUrl}/projects/${project.id}/generations`, withCookie({
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
    }, session.cookie));
    const gen = (await genRes.json()) as { generationId: string; outputAssetUrls: string[] };
    return { project, asset, generationId: gen.generationId, outputAssetUrl: gen.outputAssetUrls[0]! };
  }

  it('submits a video job asynchronously (202, status running, real providerOperationName), then polling drives it to succeeded with a real downloadable output asset', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.videoGenerationService = new VideoGenerationService({ veo: scriptedVeoAdapter(['running', 'succeeded']) });
    await start(context);
    const session = await registerTestUser(baseUrl);

    const { project, generationId, outputAssetUrl } = await createProjectAssetAndGeneration(session);
    const sourceAssetId = outputAssetUrl.split('/').pop()!;

    const submitRes = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/videos`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_VIDEO_BODY, sourceAssetId }),
    }, session.cookie));
    expect(submitRes.status).toBe(202);
    const submitBody = (await submitRes.json()) as {
      videoId: string;
      versionId: string;
      project: { currentVersionId: string };
      video: { status: string; providerOperationName: string; protectedLocks: string[] };
    };
    expect(submitBody.video.status).toBe('running');
    expect(submitBody.video.providerOperationName).toBe('operations/fake-op-1');
    expect(submitBody.video.protectedLocks).toEqual(['architecture', 'camera', 'objects', 'materials', 'temporal-consistency']);
    expect(submitBody.project.currentVersionId).toBe(submitBody.versionId);

    const version = await context.versionRepository.getById(submitBody.versionId);
    expect(version).toMatchObject({ kind: 'video', snapshotRef: submitBody.videoId });

    // First poll: provider still running — no output yet.
    const poll1 = await fetch(`${baseUrl}/projects/${project.id}/videos/${submitBody.videoId}`, withCookie({}, session.cookie));
    expect(poll1.status).toBe(200);
    const poll1Body = (await poll1.json()) as { video: { status: string }; outputAssetUrl: string | null };
    expect(poll1Body.video.status).toBe('running');
    expect(poll1Body.outputAssetUrl).toBeNull();

    // Second poll: provider reports succeeded — real output asset stored and fetchable.
    const poll2 = await fetch(`${baseUrl}/projects/${project.id}/videos/${submitBody.videoId}`, withCookie({}, session.cookie));
    expect(poll2.status).toBe(200);
    const poll2Body = (await poll2.json()) as { video: { status: string; resultingAssetId: string }; outputAssetUrl: string };
    expect(poll2Body.video.status).toBe('succeeded');
    expect(poll2Body.outputAssetUrl).toBe(`/assets/${poll2Body.video.resultingAssetId}`);

    const assetRes = await fetch(`${baseUrl}${poll2Body.outputAssetUrl}`, withCookie({}, session.cookie));
    expect(Buffer.from(await assetRes.arrayBuffer()).toString('base64')).toBe('ZmFrZS12aWRlby1ieXRlcw==');

    // A third poll on an already-terminal video returns the stored record without re-polling the provider.
    const poll3 = await fetch(`${baseUrl}/projects/${project.id}/videos/${submitBody.videoId}`, withCookie({}, session.cookie));
    const poll3Body = (await poll3.json()) as { video: { status: string } };
    expect(poll3Body.video.status).toBe('succeeded');
  });

  it('marks the video failed when the provider operation errors', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.videoGenerationService = new VideoGenerationService({ veo: scriptedVeoAdapter(['failed']) });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, generationId, outputAssetUrl } = await createProjectAssetAndGeneration(session);
    const sourceAssetId = outputAssetUrl.split('/').pop()!;

    const submitRes = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/videos`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_VIDEO_BODY, sourceAssetId }),
    }, session.cookie));
    const submitBody = (await submitRes.json()) as { videoId: string };

    const poll = await fetch(`${baseUrl}/projects/${project.id}/videos/${submitBody.videoId}`, withCookie({}, session.cookie));
    const pollBody = (await poll.json()) as { video: { status: string }; outputAssetUrl: string | null };
    expect(pollBody.video.status).toBe('failed');
    expect(pollBody.outputAssetUrl).toBeNull();
  });

  it('returns 404 for an unknown project', async () => {
    await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
    const session = await registerTestUser(baseUrl);
    const res = await fetch(`${baseUrl}/projects/does-not-exist/generations/g1/videos`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_VIDEO_BODY, sourceAssetId: 'a1' }),
    }, session.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('returns 404 for an unknown parent generation', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAssetAndGeneration(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations/does-not-exist/videos`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_VIDEO_BODY, sourceAssetId: asset.id }),
    }, session.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'GENERATION_NOT_FOUND' });
  });

  it('returns 404 when the source asset does not belong to the project', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, generationId } = await createProjectAssetAndGeneration(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/videos`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_VIDEO_BODY, sourceAssetId: 'does-not-exist' }),
    }, session.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('returns 404 for an unknown video on status poll', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project } = await createProjectAssetAndGeneration(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/videos/does-not-exist`, withCookie({}, session.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'VIDEO_NOT_FOUND' });
  });

  it('rejects an invalid motion type rather than passing it through to the provider', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.videoGenerationService = new VideoGenerationService({ veo: scriptedVeoAdapter(['running']) });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, generationId, asset } = await createProjectAssetAndGeneration(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/videos`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_VIDEO_BODY, motionType: 'zoom-blur', sourceAssetId: asset.id }),
    }, session.cookie));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a non-positive duration', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.videoGenerationService = new VideoGenerationService({ veo: scriptedVeoAdapter(['running']) });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, generationId, asset } = await createProjectAssetAndGeneration(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/videos`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_VIDEO_BODY, durationSeconds: 0, sourceAssetId: asset.id }),
    }, session.cookie));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns 503 PROVIDER_NOT_CONFIGURED for Veo when no key is set — the real, honest state right now', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }); // no VEO_API_KEY
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, generationId, asset } = await createProjectAssetAndGeneration(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/videos`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_VIDEO_BODY, sourceAssetId: asset.id }),
    }, session.cookie));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('returns 501 NOT_IMPLEMENTED for Sora — the documented BUILD 16 deprecation finding', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, generationId, asset } = await createProjectAssetAndGeneration(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/generations/${generationId}/videos`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_VIDEO_BODY, renderCore: 'Sora', sourceAssetId: asset.id }),
    }, session.cookie));
    expect(res.status).toBe(501);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('NOT_IMPLEMENTED');
    expect(body.message).toContain('2026-09-24');
  });
});
