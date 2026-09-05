import { describe, expect, it, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { ReferenceIntelligence } from '@avs/ai-core';
import { createApp } from './server.js';
import { createAppContext, type AppContext } from './app-context.js';
import { registerTestUser, TEST_REGISTRATION_SECRET, withCookie, type TestSession } from './test-helpers/auth.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const FAKE_EXTRACTED_VISUAL_LANGUAGE = {
  purpose: 'style' as const,
  weight: 1,
  fields: { style: 'Modern Minimal', influences: ['Bauhaus'] },
};

describe('apps/api reference route (BUILD 10 Reference Intelligence)', () => {
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
    const project = (await createRes.json()) as { id: string };
    const uploadRes = await fetch(`${baseUrl}/projects/${project.id}/assets`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: ONE_PIXEL_PNG,
    }, session.cookie));
    const asset = (await uploadRes.json()) as { id: string };
    return { project, asset };
  }

  it('extracts visual language for the requested purpose and persists a ReferenceRecord', async () => {
    const mockEngine: ReferenceIntelligence = { extract: vi.fn().mockResolvedValue(FAKE_EXTRACTED_VISUAL_LANGUAGE) };
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.referenceIntelligenceEngine = mockEngine;
    await start(context);
    const session = await registerTestUser(baseUrl);

    const { project, asset } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/references`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: asset.id, purpose: 'style' }),
    }, session.cookie));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { referenceId: string; extractedVisualLanguage: typeof FAKE_EXTRACTED_VISUAL_LANGUAGE };
    expect(body.extractedVisualLanguage).toEqual(FAKE_EXTRACTED_VISUAL_LANGUAGE);

    const stored = await context.referenceRepository.getById(body.referenceId);
    expect(stored).toMatchObject({ projectId: project.id, assetId: asset.id, purpose: 'style' });

    expect(mockEngine.extract).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: asset.id, contentType: 'image/png' }),
      'style',
    );
  });

  it('lets an explicit request weight override the engine default', async () => {
    const mockEngine: ReferenceIntelligence = { extract: vi.fn().mockResolvedValue(FAKE_EXTRACTED_VISUAL_LANGUAGE) };
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    context.referenceIntelligenceEngine = mockEngine;
    await start(context);
    const session = await registerTestUser(baseUrl);

    const { project, asset } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/references`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: asset.id, purpose: 'style', weight: 0.4 }),
    }, session.cookie));
    const body = (await res.json()) as { extractedVisualLanguage: { weight: number } };
    expect(body.extractedVisualLanguage.weight).toBe(0.4);
  });

  it('rejects an invalid purpose rather than passing it through to the provider', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/references`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: asset.id, purpose: 'architecture' }),
    }, session.cookie));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns 404 for an unknown project', async () => {
    await start(createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }));
    const session = await registerTestUser(baseUrl);
    const res = await fetch(`${baseUrl}/projects/does-not-exist/references`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: 'a1', purpose: 'style' }),
    }, session.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('returns 404 when the asset does not belong to the project (or does not exist)', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/references`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: 'does-not-exist', purpose: 'style' }),
    }, session.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('returns 503 PROVIDER_NOT_CONFIGURED when no GEMINI_API_KEY is set — the real, honest state right now', async () => {
    const context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET }); // no geminiApiKey — matches the real deployment until a key is supplied
    await start(context);
    const session = await registerTestUser(baseUrl);
    const { project, asset } = await createProjectAndAsset(session);
    const res = await fetch(`${baseUrl}/projects/${project.id}/references`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: asset.id, purpose: 'style' }),
    }, session.cookie));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });
});
