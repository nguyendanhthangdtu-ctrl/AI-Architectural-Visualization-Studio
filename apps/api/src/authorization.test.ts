import { describe, expect, it, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.js';
import { createAppContext, type AppContext } from './app-context.js';
import { registerTestUser, TEST_REGISTRATION_SECRET, withCookie, type TestSession } from './test-helpers/auth.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

/**
 * RELEASE 02 — dedicated cross-user IDOR coverage. Every project-scoped
 * route resolves ownership from the session-derived user, never a
 * client-supplied id (docs/16) — this proves it holds for real, across two
 * genuinely different accounts, not just "no cookie at all" (already covered
 * by auth-routes.test.ts and the retrofitted per-feature route tests).
 */
describe('apps/api cross-user authorization (RELEASE 02 IDOR protection)', () => {
  let server: ReturnType<typeof createApp> | undefined;
  let baseUrl = '';
  let context: AppContext;

  afterEach(() => {
    server?.close();
  });

  async function start() {
    context = createAppContext({ registrationSecret: TEST_REGISTRATION_SECRET });
    server = createApp(context);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  }

  async function twoUsers(): Promise<{ owner: TestSession; other: TestSession }> {
    const owner = await registerTestUser(baseUrl, 'owner@example.com');
    const other = await registerTestUser(baseUrl, 'other@example.com');
    return { owner, other };
  }

  async function ownerCreatesProjectAndAsset(owner: TestSession) {
    const createRes = await fetch(`${baseUrl}/projects`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Owner Villa', module: 'architecture' }),
    }, owner.cookie));
    const project = (await createRes.json()) as { id: string };

    const uploadRes = await fetch(`${baseUrl}/projects/${project.id}/assets`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: ONE_PIXEL_PNG,
    }, owner.cookie));
    const asset = (await uploadRes.json()) as { id: string; url: string };
    return { project, asset };
  }

  it('a non-owner cannot fetch another user\'s project (404, never leaking existence)', async () => {
    await start();
    const { owner, other } = await twoUsers();
    const { project } = await ownerCreatesProjectAndAsset(owner);

    const ownerRes = await fetch(`${baseUrl}/projects/${project.id}`, withCookie({}, owner.cookie));
    expect(ownerRes.status).toBe(200);

    const otherRes = await fetch(`${baseUrl}/projects/${project.id}`, withCookie({}, other.cookie));
    expect(otherRes.status).toBe(404);
    await expect(otherRes.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('a non-owner cannot upload an asset into another user\'s project', async () => {
    await start();
    const { owner, other } = await twoUsers();
    const { project } = await ownerCreatesProjectAndAsset(owner);

    const res = await fetch(`${baseUrl}/projects/${project.id}/assets`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: ONE_PIXEL_PNG,
    }, other.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('a non-owner cannot fetch another user\'s asset by guessing its id (asset IDOR)', async () => {
    await start();
    const { owner, other } = await twoUsers();
    const { asset } = await ownerCreatesProjectAndAsset(owner);

    const ownerRes = await fetch(`${baseUrl}${asset.url}`, withCookie({}, owner.cookie));
    expect(ownerRes.status).toBe(200);

    const otherRes = await fetch(`${baseUrl}${asset.url}`, withCookie({}, other.cookie));
    expect(otherRes.status).toBe(404);
    await expect(otherRes.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('a non-owner cannot delete another user\'s asset', async () => {
    await start();
    const { owner, other } = await twoUsers();
    const { project, asset } = await ownerCreatesProjectAndAsset(owner);
    const assetId = asset.url.split('/').pop()!.split('?')[0]!;

    const otherDelete = await fetch(`${baseUrl}/projects/${project.id}/assets/${assetId}`, withCookie({ method: 'DELETE' }, other.cookie));
    expect(otherDelete.status).toBe(404);

    // Still fetchable by the real owner — the non-owner's attempt had no effect.
    const ownerRes = await fetch(`${baseUrl}${asset.url}`, withCookie({}, owner.cookie));
    expect(ownerRes.status).toBe(200);
  });

  it('a non-owner cannot run analysis against another user\'s project/asset', async () => {
    await start();
    const { owner, other } = await twoUsers();
    const { project, asset } = await ownerCreatesProjectAndAsset(owner);

    const res = await fetch(`${baseUrl}/projects/${project.id}/analysis`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: asset.id }),
    }, other.cookie));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('never trusts a client-supplied ownerId/userId — the real owner is always the session, not the request body', async () => {
    await start();
    const { owner } = await twoUsers();
    const res = await fetch(`${baseUrl}/projects`, withCookie({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Attempting to smuggle a different owner via the body — must be ignored entirely.
      body: JSON.stringify({ name: 'Villa', module: 'architecture', ownerId: 'someone-else', userId: 'someone-else' }),
    }, owner.cookie));
    const project = (await res.json()) as { ownerId: string };
    expect(project.ownerId).toBe(owner.userId);
  });
});
