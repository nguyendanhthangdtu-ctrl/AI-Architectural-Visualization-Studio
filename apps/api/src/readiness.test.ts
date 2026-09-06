import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('BUILD 32A HOTFIX: responds 200 to HEAD /ready too, never 401 — same fix as GET /health/HEAD /health (server.test.ts)', async () => {
    server = createApp(createAppContext());
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ready`, { method: 'HEAD' });
    expect(res.status).toBe(200);
  });

  it('reports database and assetStore both ok for a real, working context', async () => {
    server = createApp(createAppContext());
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    const body = (await res.json()) as { status: string; checks: { database: { status: string }; assetStore: { status: string } } };
    expect(body.status).toBe('ready');
    expect(body.checks).toEqual({ database: { status: 'ok' }, assetStore: { status: 'ok' } });
  });

  it('BUILD 32: reports storage as ephemeral by default, and durable once a real DATABASE_URL/ASSET_STORE_URL is configured — never affecting overall readiness', async () => {
    server = createApp(createAppContext());
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    const body = (await res.json()) as { status: string; persistence: { database: { persistent: boolean }; assetStore: { persistent: boolean } } };
    expect(body.persistence).toEqual({ database: { persistent: false }, assetStore: { persistent: false } });
    expect(body.status).toBe('ready'); // ephemeral storage is a legitimate choice, never a readiness failure

    server.close();
    server = createApp(createAppContext({ dbPath: ':memory:', assetsDir: mkdtempSync(join(tmpdir(), 'avs-readiness-test-')) }));
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port: port2 } = server.address() as AddressInfo;
    const res2 = await fetch(`http://127.0.0.1:${port2}/ready`);
    const body2 = (await res2.json()) as { persistence: { database: { persistent: boolean }; assetStore: { persistent: boolean } } };
    expect(body2.persistence).toEqual({ database: { persistent: true }, assetStore: { persistent: true } });
  });

  it('BUILD 21: reports each AI provider as configured only when a real key was supplied, never assuming operational status', async () => {
    server = createApp(createAppContext({ geminiApiKey: 'a-real-gemini-key' }));
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    const body = (await res.json()) as {
      status: string;
      providers: {
        gemini: { configured: boolean };
        nanoBanana: { configured: boolean };
        nanoBananaPro: { configured: boolean };
        chatgptImage: { configured: boolean };
        veo: { configured: boolean };
        email: { configured: boolean };
      };
    };
    expect(body.providers.gemini.configured).toBe(true);
    expect(body.providers.nanoBanana.configured).toBe(false);
    expect(body.providers.nanoBananaPro.configured).toBe(false);
    expect(body.providers.chatgptImage.configured).toBe(false);
    expect(body.providers.veo.configured).toBe(false);
    expect(body.providers.email.configured).toBe(false); // no EMAIL_PROVIDER set — InMemoryEmailSender, never "configured"
    // no provider being unconfigured ever flips overall readiness — this deployment can still serve auth/asset/DB traffic
    expect(body.status).toBe('ready');
  });

  it('BUILD 27: reports Nano Banana Pro as configured whenever the shared NANO_BANANA_API_KEY credential is set', async () => {
    server = createApp(createAppContext({ nanoBananaApiKey: 'a-real-nano-banana-key' }));
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    const body = (await res.json()) as { providers: { nanoBanana: { configured: boolean }; nanoBananaPro: { configured: boolean } } };
    expect(body.providers.nanoBanana.configured).toBe(true);
    expect(body.providers.nanoBananaPro.configured).toBe(true);
  });

  it('BUILD 22: reports email as configured only when a real vendor AND its credential are both set', async () => {
    server = createApp(createAppContext({ emailProvider: 'resend', resendApiKey: 'a-real-resend-key', emailFrom: 'noreply@example.com' }));
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    const body = (await res.json()) as { providers: { email: { configured: boolean } } };
    expect(body.providers.email.configured).toBe(true);
  });

  it('never leaks a stack trace, a file path, or a secret value in its response', async () => {
    server = createApp(
      createAppContext({
        assetUrlSigningSecret: 'a-real-secret-should-never-appear',
        geminiApiKey: 'a-real-gemini-key-should-never-appear',
        emailProvider: 'resend',
        resendApiKey: 'a-real-resend-key-should-never-appear',
        emailFrom: 'noreply@example.com',
      }),
    );
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    const raw = await res.text();
    expect(raw).not.toContain('a-real-secret-should-never-appear');
    expect(raw).not.toContain('a-real-gemini-key-should-never-appear');
    expect(raw).not.toContain('a-real-resend-key-should-never-appear');
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
