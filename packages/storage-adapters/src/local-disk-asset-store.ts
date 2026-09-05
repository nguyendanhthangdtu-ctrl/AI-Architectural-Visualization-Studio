import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError } from '@avs/shared';
import type { AssetId, ProjectId } from '@avs/shared';
import type { AssetRef, AssetStore } from '@avs/project-core';

/**
 * Local-disk blob storage — BUILD 18's concrete answer to docs/03 §13
 * "concrete blob storage vendor": real files under a configured directory,
 * not another in-memory Map that resets on restart. A real cloud object
 * store (S3/GCS/etc.) swap stays open behind this same `AssetStore`
 * interface (docs/03 §13), unchanged for every caller.
 *
 * Metadata (`AssetRef`) is a JSON sidecar next to each blob rather than a
 * `SqliteDatabase` row — deliberately independent of the relational engine:
 * a real blob store swap (S3, etc.) would carry its own metadata mechanism
 * anyway, so coupling asset metadata to SQLite would just be something to
 * undo later.
 */
export class LocalDiskAssetStore implements AssetStore {
  constructor(private readonly baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
  }

  private dataPath(id: string): string {
    return join(this.baseDir, `${id}.bin`);
  }

  private metaPath(id: string): string {
    return join(this.baseDir, `${id}.meta.json`);
  }

  async put(params: { projectId: ProjectId; contentType: string; data: Uint8Array }): Promise<AssetRef> {
    const id = randomUUID() as AssetId;
    const ref: AssetRef = {
      id,
      projectId: params.projectId,
      url: `file://${id}`,
      contentType: params.contentType,
      sizeBytes: params.data.byteLength,
    };
    writeFileSync(this.dataPath(id), Buffer.from(params.data));
    writeFileSync(this.metaPath(id), JSON.stringify(ref));
    return ref;
  }

  async get(id: AssetId): Promise<{ ref: AssetRef; data: Uint8Array } | null> {
    if (!existsSync(this.metaPath(id)) || !existsSync(this.dataPath(id))) return null;
    const ref = JSON.parse(readFileSync(this.metaPath(id), 'utf-8')) as AssetRef;
    const data = new Uint8Array(readFileSync(this.dataPath(id)));
    return { ref, data };
  }

  /**
   * Not the real, HTTP-facing signed-URL mechanism — that's `buildAssetUrl()`
   * in `apps/api/src/signed-asset-url.ts`, invoked directly by each route
   * (it needs the `/assets/:id` HTTP path, a web-layer concern this
   * storage-layer interface has no business knowing about). This stays a
   * plain internal reference, matching the interface's pre-existing (never
   * previously called by any route) contract.
   */
  async getSignedUrl(id: AssetId): Promise<string> {
    const found = await this.get(id);
    if (!found) {
      throw new DomainError({ code: 'ASSET_NOT_FOUND', message: `No asset with id ${id}`, retryable: false });
    }
    return found.ref.url;
  }

  async scheduleDeletion(id: AssetId): Promise<void> {
    if (existsSync(this.dataPath(id))) rmSync(this.dataPath(id));
    if (existsSync(this.metaPath(id))) rmSync(this.metaPath(id));
  }
}
