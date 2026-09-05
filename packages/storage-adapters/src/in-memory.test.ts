import { describe, expect, it } from 'vitest';
import type { AssetId, ProjectId, Timestamp } from '@avs/shared';
import {
  InMemoryAnalysisRepository,
  InMemoryAssetStore,
  InMemoryProjectRepository,
  InMemoryVersionRepository,
} from './in-memory.js';

describe('InMemoryProjectRepository', () => {
  it('round-trips a project and rejects updates to an unknown id', async () => {
    const repo = new InMemoryProjectRepository();
    const project = {
      id: 'p1' as ProjectId,
      name: 'Villa A',
      module: 'architecture' as const,
      createdAt: '2026-09-04T00:00:00.000Z' as Timestamp,
      updatedAt: '2026-09-04T00:00:00.000Z' as Timestamp,
      status: 'draft' as const,
      currentVersionId: 'v0',
    };
    await repo.create(project);
    await expect(repo.getById('p1' as ProjectId)).resolves.toEqual(project);
    await expect(repo.update({ ...project, id: 'missing' as ProjectId })).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
    });
  });
});

describe('InMemoryAssetStore', () => {
  it('round-trips the actual bytes, not just metadata', async () => {
    const store = new InMemoryAssetStore();
    const data = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    const ref = await store.put({ projectId: 'p1' as ProjectId, contentType: 'image/png', data });
    const result = await store.get(ref.id);
    expect(result?.ref).toEqual(ref);
    expect(result?.data).toEqual(data);
  });

  it('returns null for an unknown asset id rather than throwing', async () => {
    const store = new InMemoryAssetStore();
    await expect(store.get('missing' as AssetId)).resolves.toBeNull();
  });

  it('removes both the ref and the bytes on scheduleDeletion', async () => {
    const store = new InMemoryAssetStore();
    const ref = await store.put({ projectId: 'p1' as ProjectId, contentType: 'image/png', data: new Uint8Array([1]) });
    await store.scheduleDeletion(ref.id);
    await expect(store.get(ref.id)).resolves.toBeNull();
  });
});

describe('InMemoryAnalysisRepository', () => {
  it('round-trips an analysis record, storing structuredIntelligence opaquely', async () => {
    const repo = new InMemoryAnalysisRepository();
    const record = {
      id: 'an1',
      projectId: 'p1' as ProjectId,
      sourceAssetId: 'asset-1' as AssetId,
      analysisVersion: 'gemini:test:2026-09-04T00:00:00.000Z',
      structuredIntelligence: { some: 'shape' },
      createdAt: '2026-09-04T00:00:00.000Z',
    };
    await repo.create(record);
    await expect(repo.getById('an1')).resolves.toEqual(record);
  });

  it('returns null for an unknown analysis id', async () => {
    const repo = new InMemoryAnalysisRepository();
    await expect(repo.getById('missing')).resolves.toBeNull();
  });
});

describe('InMemoryVersionRepository', () => {
  it('lists only versions belonging to the requested project', async () => {
    const repo = new InMemoryVersionRepository();
    await repo.create({
      id: 'v1',
      projectId: 'p1',
      parentVersionId: null,
      kind: 'analysis',
      snapshotRef: 'ref-1',
      createdAt: '2026-09-04T00:00:00.000Z' as Timestamp,
      createdBy: 'u1' as never,
    });
    await repo.create({
      id: 'v2',
      projectId: 'p2',
      parentVersionId: null,
      kind: 'analysis',
      snapshotRef: 'ref-2',
      createdAt: '2026-09-04T00:00:00.000Z' as Timestamp,
      createdBy: 'u1' as never,
    });
    const versions = await repo.listByProject('p1' as ProjectId);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.id).toBe('v1');
  });
});
