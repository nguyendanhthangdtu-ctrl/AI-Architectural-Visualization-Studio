import { describe, expect, it, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.js';

describe('apps/api bootstrap server', () => {
  let server: ReturnType<typeof createApp> | undefined;

  afterEach(() => {
    server?.close();
  });

  it('responds to GET /health', async () => {
    server = createApp();
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  it('returns a normalized error envelope for an unknown route, with no stack trace leaked', async () => {
    server = createApp();
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'NOT_FOUND', retryable: false });
    expect(Object.keys(body)).not.toContain('stack');
  });
});
