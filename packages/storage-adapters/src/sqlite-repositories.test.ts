import { describe, expect, it } from 'vitest';
import type { ProjectId, Timestamp, UserId } from '@avs/shared';
import { SqliteDatabase } from './sqlite-database.js';
import {
  SqliteAnalysisRepository,
  SqliteAuditLogRepository,
  SqliteProjectRepository,
  SqliteSessionRepository,
  SqliteUserRepository,
  SqliteVersionRepository,
} from './sqlite-repositories.js';

/** Every test opens a fresh `:memory:` database — real SQLite, ephemeral, same speed/isolation as the old in-memory Maps. */
function freshDb(): SqliteDatabase {
  return new SqliteDatabase(':memory:');
}

describe('SqliteProjectRepository', () => {
  it('round-trips a project and rejects updates to an unknown id', async () => {
    const repo = new SqliteProjectRepository(freshDb());
    const project = {
      id: 'p1' as ProjectId,
      ownerId: 'u1' as never,
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

  it('persists an update for real, not just accepting it', async () => {
    const db = freshDb();
    const repo = new SqliteProjectRepository(db);
    const project = {
      id: 'p1' as ProjectId,
      ownerId: 'u1' as never,
      name: 'Villa A',
      module: 'architecture' as const,
      createdAt: 't' as Timestamp,
      updatedAt: 't' as Timestamp,
      status: 'draft' as const,
      currentVersionId: 'v0',
    };
    await repo.create(project);
    await repo.update({ ...project, currentVersionId: 'v1' });
    await expect(repo.getById('p1' as ProjectId)).resolves.toMatchObject({ currentVersionId: 'v1' });
  });
});

describe('SqliteAnalysisRepository', () => {
  it('round-trips an analysis record, storing structuredIntelligence opaquely', async () => {
    const repo = new SqliteAnalysisRepository(freshDb());
    const record = {
      id: 'an1',
      projectId: 'p1' as ProjectId,
      sourceAssetId: 'asset-1' as never,
      analysisVersion: 'gemini:test:2026-09-04T00:00:00.000Z',
      structuredIntelligence: { some: 'shape' },
      createdAt: '2026-09-04T00:00:00.000Z',
    };
    await repo.create(record);
    await expect(repo.getById('an1')).resolves.toEqual(record);
  });

  it('returns null for an unknown analysis id', async () => {
    const repo = new SqliteAnalysisRepository(freshDb());
    await expect(repo.getById('missing')).resolves.toBeNull();
  });
});

describe('SqliteVersionRepository', () => {
  it('lists only versions belonging to the requested project', async () => {
    const repo = new SqliteVersionRepository(freshDb());
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

describe('SqliteAuditLogRepository', () => {
  it('records an append-only event and lists it back scoped to its project', async () => {
    const repo = new SqliteAuditLogRepository(freshDb());
    await repo.record({
      id: 'ev1',
      action: 'asset.access',
      actorId: 'anonymous',
      projectId: 'p1' as ProjectId,
      targetId: 'asset-1',
      metadata: {},
      createdAt: '2026-09-04T00:00:00.000Z',
    });
    await repo.record({
      id: 'ev2',
      action: 'asset.access',
      actorId: 'anonymous',
      projectId: 'p2' as ProjectId,
      targetId: 'asset-2',
      metadata: {},
      createdAt: '2026-09-04T00:00:00.000Z',
    });
    const events = await repo.listByProject('p1' as ProjectId);
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('ev1');
  });
});

describe('SqliteUserRepository (RELEASE 02)', () => {
  it('round-trips a user by id and by email (case-insensitively)', async () => {
    const repo = new SqliteUserRepository(freshDb());
    const user = { id: 'u1' as UserId, email: 'Owner@Example.com', passwordHash: 'salt:hash', createdAt: 't' as Timestamp };
    await repo.create(user);
    await expect(repo.getById('u1' as UserId)).resolves.toEqual(user);
    await expect(repo.getByEmail('owner@example.com')).resolves.toEqual(user);
    await expect(repo.getByEmail('OWNER@EXAMPLE.COM')).resolves.toEqual(user);
  });

  it('rejects creating a second user with the same email', async () => {
    const repo = new SqliteUserRepository(freshDb());
    await repo.create({ id: 'u1' as UserId, email: 'dup@example.com', passwordHash: 'x', createdAt: 't' as Timestamp });
    await expect(
      repo.create({ id: 'u2' as UserId, email: 'dup@example.com', passwordHash: 'y', createdAt: 't' as Timestamp }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
  });

  it('returns null for an unknown id/email rather than throwing', async () => {
    const repo = new SqliteUserRepository(freshDb());
    await expect(repo.getById('missing' as UserId)).resolves.toBeNull();
    await expect(repo.getByEmail('nobody@example.com')).resolves.toBeNull();
  });
});

describe('SqliteSessionRepository (RELEASE 02)', () => {
  it('round-trips a session and supports real deletion (logout)', async () => {
    const repo = new SqliteSessionRepository(freshDb());
    const session = { id: 'sess-1', userId: 'u1' as UserId, createdAt: 't' as Timestamp, expiresAt: 'later' as Timestamp };
    await repo.create(session);
    await expect(repo.getById('sess-1')).resolves.toEqual(session);
    await repo.deleteById('sess-1');
    await expect(repo.getById('sess-1')).resolves.toBeNull();
  });
});

describe('real durability across a database re-open (the actual point of the SQLite swap)', () => {
  it('survives closing and re-opening the same file-backed database', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'avs-sqlite-test-'));
    const dbPath = join(dir, 'test.sqlite3');
    try {
      const db1 = new SqliteDatabase(dbPath);
      const repo1 = new SqliteProjectRepository(db1);
      await repo1.create({
        id: 'p1' as ProjectId,
        ownerId: 'u1' as never,
        name: 'Villa A',
        module: 'architecture' as const,
        createdAt: 't' as Timestamp,
        updatedAt: 't' as Timestamp,
        status: 'draft' as const,
        currentVersionId: '',
      });
      db1.close();

      const db2 = new SqliteDatabase(dbPath);
      const repo2 = new SqliteProjectRepository(db2);
      await expect(repo2.getById('p1' as ProjectId)).resolves.toMatchObject({ name: 'Villa A' });
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
