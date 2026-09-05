import { describe, expect, it, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { VisionAnalysisEngine } from '@avs/ai-core';
import { createApp } from './server.js';
import { createAppContext, type AppContext } from './app-context.js';
import { registerTestUser, TEST_REGISTRATION_SECRET, withCookie, type TestSession } from './test-helpers/auth.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const FAKE_STRUCTURED_INTELLIGENCE = {
  analysisVersion: 'gemini:test-model:2026-09-04T00:00:00.000Z',
  module: 'architecture' as const,
  layers: { subject: { confidence: 0.9, warnings: [], data: { type: 'building', description: 'test' } } },
};

describe('apps/api analysis route (BUILD 07 Vision Analysis Engine)', () => {
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

  async function createProjectAndAsset(context: AppContext, session: TestSession) {
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
    void context;
    return { project, asset };
  }

  it('runs analysis, persists it, creates a version, and advances the project — never mutating the prior version', async () => {
    const mockEngine: VisionAnalysisEngine = { analyze: vi.fn().mockResolvedValue(FAKE_STRUCTURED_INTELLIGENCE) };
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.visionAnalysisEngine = mockEngine;
    await start(context);
    const session = await registerTestUser(baseUrl);

    const { project, asset } = await createProjectAndAsset(context, session);
    expect(project.currentVersionId).toBe(''); // no analysis has run yet

    const res = await fetch(`${baseUrl}/projects/${project.id}/analysis`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: asset.id }),
    }, session.cookie));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      analysisId: string;
      versionId: string;
      project: { currentVersionId: string };
      structuredIntelligence: typeof FAKE_STRUCTURED_INTELLIGENCE;
    };
    expect(body.structuredIntelligence).toEqual(FAKE_STRUCTURED_INTELLIGENCE);
    expect(body.project.currentVersionId).toBe(body.versionId);
    expect(body.versionId).not.toBe(project.currentVersionId); // a new version, not the old (empty) one

    const version = await context.versionRepository.getById(body.versionId);
    expect(version).toMatchObject({ kind: 'analysis', projectId: project.id, snapshotRef: body.analysisId });

    const analysis = await context.analysisRepository.getById(body.analysisId);
    expect(analysis?.structuredIntelligence).toEqual(FAKE_STRUCTURED_INTELLIGENCE);

    expect(mockEngine.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: asset.id, contentType: 'image/png' }),
      'architecture',
    );
  });

  it('returns 404 for an unknown project', async () => {
    await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
    const session = await registerTestUser(baseUrl);
    const res = await fetch(`${baseUrl}/projects/does-not-exist/analysis`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: 'a1' }),
    }, session.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('returns 404 when the asset does not belong to the project (or does not exist)', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project } = await createProjectAndAsset(context, session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/analysis`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: 'does-not-exist' }),
    }, session.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('returns 503 PROVIDER_NOT_CONFIGURED when no GEMINI_API_KEY is set — the real, honest state right now', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }); // no geminiApiKey — matches the real deployment until a key is supplied
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(context, session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/analysis`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: asset.id }),
    }, session.cookie));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });
});
