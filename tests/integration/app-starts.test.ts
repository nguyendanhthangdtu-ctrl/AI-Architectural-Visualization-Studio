import { describe, expect, it, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Real process-level smoke test — BUILD 02 acceptance I.1 "Application
 * starts." Unlike apps/api/src/server.test.ts (which imports createApp()
 * directly and never exercises the entry-point/isMainModule path), this
 * spawns the actual built server binary the way `npm start`/production would,
 * catching bugs the in-process test cannot (e.g. the isMainModule detection
 * that silently failed on Windows path handling before this test existed).
 *
 * Requires `npm run build` to have produced apps/api/dist/server.js — skips
 * itself with a clear message if run before a build, rather than failing
 * typecheck/lint runs that don't build first.
 */
const serverEntry = fileURLToPath(new URL('../../apps/api/dist/server.js', import.meta.url));

describe.skipIf(!existsSync(serverEntry))('apps/api built server (process-level)', () => {
  let child: ChildProcess | undefined;

  afterEach(() => {
    child?.kill();
  });

  it('starts, binds a port, and answers GET /health with no secrets in the environment', async () => {
    const port = 8099;
    child = spawn(process.execPath, [serverEntry], {
      env: { ...process.env, API_PORT: String(port) },
      stdio: 'pipe',
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('server did not report listening in time')), 5000);
      child!.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('listening')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child!.on('error', reject);
      child!.on('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`server process exited early with code ${code}`));
      });
    });

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });
});
