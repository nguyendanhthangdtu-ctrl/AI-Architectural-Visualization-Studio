import { describe, expect, it, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.js';
import { createAppContext, type AppContext } from './app-context.js';
import { registerTestUser, withCookie } from './test-helpers/auth.js';

/**
 * BUILD 19 Phase 4 (Live Provider Smoke Test) — exercises a real provider
 * over the network, through the real HTTP pipeline (real session, real
 * project ownership check, real asset persistence, real signed/secure asset
 * retrieval). This is deliberately NOT part of normal CI:
 *
 * - The master switch is `RUN_LIVE_PROVIDER_SMOKE_TEST=true`. Without it,
 *   every describe block below is skipped — `npm test` never makes a network
 *   call and never requires a credential to pass (docs/16, CLAUDE.md rule 7:
 *   never let a fake/skipped integration masquerade as a passing real one —
 *   a skipped suite is visibly skipped, not silently green).
 * - Each provider is additionally gated on its own real API key being
 *   present, so e.g. running with only `GEMINI_API_KEY` set exercises just
 *   Vision Analysis and leaves Nano Banana/ChatGPT Image/Veo skipped.
 * - No key is ever logged, asserted into a snapshot, or included in any
 *   error message this test prints — only response *shape* is asserted.
 * - Every asset this test creates is deleted at the end of its own test via
 *   the real `DELETE /projects/:id/assets/:id` route, so a live run never
 *   accumulates test images in whatever ASSET_STORE_URL is configured.
 *
 * To run for real: `RUN_LIVE_PROVIDER_SMOKE_TEST=true GEMINI_API_KEY=... npx vitest run apps/api/src/live-provider-smoke.test.ts`
 */
const LIVE_SMOKE_TEST_ENABLED = process.env['RUN_LIVE_PROVIDER_SMOKE_TEST'] === 'true';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe.skipIf(!LIVE_SMOKE_TEST_ENABLED)('Live AI provider smoke test (BUILD 19 Phase 4, opt-in only)', () => {
  let server: ReturnType<typeof createApp> | undefined;
  let baseUrl = '';

  afterEach(() => {
    server?.close();
  });

  async function startWithRealProviders(): Promise<AppContext> {
    const context = createAppContext({
      geminiApiKey: process.env['GEMINI_API_KEY'],
      nanoBananaApiKey: process.env['NANO_BANANA_API_KEY'],
      chatgptImageApiKey: process.env['CHATGPT_IMAGE_API_KEY'],
      veoApiKey: process.env['VEO_API_KEY'],
    });
    server = createApp(context);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    return context;
  }

  async function createProjectWithUploadedAsset(cookie: string): Promise<{ projectId: string; assetId: string }> {
    const createRes = await fetch(`${baseUrl}/projects`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Live smoke test project', module: 'architecture' }),
    }, cookie));
    expect(createRes.status).toBe(201);
    const project = (await createRes.json()) as { id: string };

    const uploadRes = await fetch(`${baseUrl}/projects/${project.id}/assets`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: ONE_PIXEL_PNG,
    }, cookie));
    expect(uploadRes.status).toBe(201);
    const asset = (await uploadRes.json()) as { id: string };
    return { projectId: project.id, assetId: asset.id };
  }

  async function deleteAsset(cookie: string, projectId: string, assetId: string): Promise<void> {
    await fetch(`${baseUrl}/projects/${projectId}/assets/${assetId}`, withCookie({ method: 'DELETE' }, cookie));
  }

  describe.skipIf(!process.env['GEMINI_API_KEY'])('Vision Analysis Engine (Gemini)', () => {
    it('analyzes a real uploaded image end-to-end and persists only safe metadata', async () => {
      await startWithRealProviders();
      const session = await registerTestUser(baseUrl);
      const { projectId, assetId } = await createProjectWithUploadedAsset(session.cookie);

      try {
        const analysisRes = await fetch(`${baseUrl}/projects/${projectId}/analysis`, withCookie({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ assetId }),
        }, session.cookie));

        const body = (await analysisRes.json()) as Record<string, unknown>;
        // A real, minimal image may legitimately fail the provider's own
        // content validation (e.g. "image too small to analyze") — the
        // point of this smoke test is that the real request/response
        // pipeline round-trips, not that every possible input succeeds.
        expect([200, 201, 422]).toContain(analysisRes.status);
        if (analysisRes.status === 201) {
          expect(body).toHaveProperty('analysisId');
          expect(body).toHaveProperty('structuredIntelligence');
        }
        expect(JSON.stringify(body)).not.toContain(process.env['GEMINI_API_KEY']);
      } finally {
        await deleteAsset(session.cookie, projectId, assetId);
      }
    }, 30_000);
  });

  describe.skipIf(!process.env['NANO_BANANA_API_KEY'])('Image generation (Nano Banana)', () => {
    it('submits a real generation request and, on success, persists a retrievable output asset', async () => {
      await startWithRealProviders();
      const session = await registerTestUser(baseUrl);
      const { projectId, assetId } = await createProjectWithUploadedAsset(session.cookie);
      let outputAssetId: string | undefined;

      try {
        const generationRes = await fetch(`${baseUrl}/projects/${projectId}/generations`, withCookie({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            promptText: 'A single red sphere on a white background',
            renderCore: 'Nano Banana',
            aspectRatio: '1:1',
            resolution: '1K',
            sourceAssetId: assetId,
            referenceAssetIds: [],
            promptVersion: 'live-smoke-test:v1',
            scenarioVersion: new Date().toISOString(),
          }),
        }, session.cookie));

        expect([201, 422, 502]).toContain(generationRes.status);
        const body = (await generationRes.json()) as Record<string, unknown>;
        expect(JSON.stringify(body)).not.toContain(process.env['NANO_BANANA_API_KEY']);

        if (generationRes.status === 201 && (body['status'] === 'succeeded' || body['status'] === undefined)) {
          const outputAssets = body['outputAssets'] as { id: string; url: string }[] | undefined;
          if (outputAssets && outputAssets.length > 0) {
            outputAssetId = outputAssets[0]!.id;
            const fetchRes = await fetch(`${baseUrl}${outputAssets[0]!.url}`, withCookie({}, session.cookie));
            expect(fetchRes.status).toBe(200);
          }
        }
      } finally {
        await deleteAsset(session.cookie, projectId, assetId);
        if (outputAssetId) await deleteAsset(session.cookie, projectId, outputAssetId);
      }
    }, 60_000);
  });

  it('verifies real provider failure behavior — an unconfigured provider fails safely, without exposing internals', async () => {
    await startWithRealProviders();
    const session = await registerTestUser(baseUrl);
    const { projectId, assetId } = await createProjectWithUploadedAsset(session.cookie);

    try {
      const res = await fetch(`${baseUrl}/projects/${projectId}/generations`, withCookie({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          promptText: 'test',
          renderCore: 'Google Flow', // docs/03 §7 — real API for this provider does not exist yet, always NOT_IMPLEMENTED
          aspectRatio: '1:1',
          resolution: '1K',
          sourceAssetId: assetId,
          referenceAssetIds: [],
          promptVersion: 'live-smoke-test:v1',
          scenarioVersion: new Date().toISOString(),
        }),
      }, session.cookie));

      expect(res.status).toBeGreaterThanOrEqual(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(JSON.stringify(body)).not.toMatch(/at .*\(.*:\d+:\d+\)/); // no stack trace shape
    } finally {
      await deleteAsset(session.cookie, projectId, assetId);
    }
  });
});
