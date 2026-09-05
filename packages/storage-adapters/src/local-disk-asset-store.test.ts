import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssetId, ProjectId } from '@avs/shared';
import { LocalDiskAssetStore } from './local-disk-asset-store.js';

describe('LocalDiskAssetStore', () => {
  let dir: string;
  let store: LocalDiskAssetStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'avs-assets-test-'));
    store = new LocalDiskAssetStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips the actual bytes, not just metadata', async () => {
    const data = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    const ref = await store.put({ projectId: 'p1' as ProjectId, contentType: 'image/png', data });
    const result = await store.get(ref.id);
    expect(result?.ref).toEqual(ref);
    expect(result?.data).toEqual(data);
  });

  it('returns null for an unknown asset id rather than throwing', async () => {
    await expect(store.get('missing' as AssetId)).resolves.toBeNull();
  });

  it('removes both the bytes and the metadata sidecar on scheduleDeletion', async () => {
    const ref = await store.put({ projectId: 'p1' as ProjectId, contentType: 'image/png', data: new Uint8Array([1]) });
    await store.scheduleDeletion(ref.id);
    await expect(store.get(ref.id)).resolves.toBeNull();
  });

  it('survives being re-opened against the same directory (real disk durability)', async () => {
    const ref = await store.put({ projectId: 'p1' as ProjectId, contentType: 'image/png', data: new Uint8Array([1, 2, 3]) });
    const reopened = new LocalDiskAssetStore(dir);
    const result = await reopened.get(ref.id);
    expect(result?.data).toEqual(new Uint8Array([1, 2, 3]));
  });
});
