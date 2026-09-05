import { describe, expect, it, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.js';
import { createAppContext } from './app-context.js';

/**
 * BUILD 19 Phase 6 — `/health` (already covered in server.test.ts) is
 * unconditional "process alive"; `/ready` is the real dependency check.
 */
describe('GET /ready (BUILD 19 Production Environment Validation)', () => {
  let server: ReturnType<typeof createApp> | undefined;

  afterEach(() => {
    server?.close();
  });

  it('is a public route — no session required', async () => {
    server = createApp(createAppContext());
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(res.status).toBe(200);
  });

  it('reports database and assetStore both ok for a real, working context', async () => {
    server = createApp(createAppContext());
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    const body = (await res.json()) as { status: string; checks: { database: { status: string }; assetStore: { status: string } } };
    expect(body).toEqual({ status: 'ready', checks: { database: { status: 'ok' }, assetStore: { status: 'ok' } } });
  });

  it('never leaks a stack trace, a file path, or a secret value in its response', async () => {
    server = createApp(createAppContext({ assetUrlSigningSecret: 'a-real-secret-should-never-appear' }));
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    const raw = await res.text();
    expect(raw).not.toContain('a-real-secret-should-never-appear');
    expect(raw).not.toContain('stack');
  });

  it('reports not_ready (503) when the database is actually unreachable', async () => {
    const context = createAppContext();
    context.projectRepository = {
      create: async (p) => p,
      getById: async () => {
        throw new Error('connection closed');
      },
      update: async (p) => p,
    };
    server = createApp(context);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; checks: { database: { status: string } } };
    expect(body.status).toBe('not_ready');
    expect(body.checks.database.status).toBe('error');
  });
});
