import { describe, expect, it, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('apps/api project + asset routes (BUILD 06 Image Ingestion)', () => {
  let server: ReturnType<typeof createApp> | undefined;
  let baseUrl = '';

  afterEach(() => {
    server?.close();
  });

  async function start() {
    server = createApp(); // fresh AppContext per test — no cross-test state leakage
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  }

  it('creates a project and can fetch it back', async () => {
    await start();
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Villa A', module: 'architecture' }),
    });
    expect(createRes.status).toBe(201);
    const project = (await createRes.json()) as { id: string; name: string; module: string };
    expect(project.name).toBe('Villa A');
    expect(project.module).toBe('architecture');
    expect(project.id).toBeTruthy();

    const getRes = await fetch(`${baseUrl}/projects/${project.id}`);
    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toEqual(project);
  });

  it('rejects project creation with an invalid payload, never creating a partial project', async () => {
    await start();
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', module: 'architecture' }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns 404 for an unknown project id, with no stack trace leaked', async () => {
    await start();
    const res = await fetch(`${baseUrl}/projects/does-not-exist`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(Object.keys(body)).not.toContain('stack');
  });

  it('uploads a valid image to an existing project and can fetch the exact bytes back', async () => {
    await start();
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
    expect(uploadRes.status).toBe(201);
    const asset = (await uploadRes.json()) as { id: string; url: string; contentType: string; sizeBytes: number };
    expect(asset.contentType).toBe('image/png');
    expect(asset.sizeBytes).toBe(ONE_PIXEL_PNG.length);
    expect(asset.url).toBe(`/assets/${asset.id}`);

    const fetchRes = await fetch(`${baseUrl}${asset.url}`);
    expect(fetchRes.status).toBe(200);
    expect(fetchRes.headers.get('content-type')).toBe('image/png');
    const bytes = Buffer.from(await fetchRes.arrayBuffer());
    expect(bytes.equals(ONE_PIXEL_PNG)).toBe(true);
  });

  it('rejects an upload to an unknown project rather than storing an orphaned asset', async () => {
    await start();
    const res = await fetch(`${baseUrl}/projects/does-not-exist/assets`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: ONE_PIXEL_PNG,
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('rejects an unsupported content type at the upload boundary (docs/16)', async () => {
    await start();
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Villa A', module: 'architecture' }),
    });
    const project = (await createRes.json()) as { id: string };

    const res = await fetch(`${baseUrl}/projects/${project.id}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: Buffer.from('not an image'),
    });
    expect(res.status).toBe(415);
    await expect(res.json()).resolves.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('returns 404 for an unknown asset id', async () => {
    await start();
    const res = await fetch(`${baseUrl}/assets/does-not-exist`);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  it('answers CORS preflight requests and reflects an allowlisted origin, but not an unlisted one (BUILD 18)', async () => {
    await start();
    const preflight = await fetch(`${baseUrl}/projects`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

    const res = await fetch(`${baseUrl}/health`, { headers: { origin: 'http://localhost:5173' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

    const untrusted = await fetch(`${baseUrl}/health`, { headers: { origin: 'https://evil.example' } });
    expect(untrusted.headers.get('access-control-allow-origin')).toBeNull();
  });
});
