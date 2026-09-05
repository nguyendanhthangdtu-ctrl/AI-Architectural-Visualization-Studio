import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

/**
 * Loaded via `createRequire` rather than a static `import 'node:sqlite'`:
 * this codebase's test runner (Vitest 2.1.9 / vite-node) predates
 * `node:sqlite`'s existence and mis-transforms a static import of it into a
 * bare "sqlite" specifier, which then fails to resolve — a real tooling gap,
 * not a code issue (confirmed by reproducing it with a minimal test file
 * outside this module). `createRequire` sidesteps vite-node's static
 * import-rewriting entirely and works identically under plain Node, so
 * there's exactly one code path for both production and tests.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

/**
 * `node:sqlite`-backed storage engine — BUILD 18's concrete answer to
 * docs/03 §13 "concrete relational database engine": built into Node itself
 * (stable since Node 22.5, and this project already targets Node 20+/24 in
 * practice), so this is real, durable, zero-external-vendor persistence —
 * not another in-memory placeholder — while still leaving a genuine
 * multi-instance/managed-Postgres swap open behind the same repository
 * interfaces (docs/03 §13 still names that as a possible future decision,
 * not fixed here; nothing above `SqliteDatabase` changes if that swap
 * happens — only `app-context.ts`'s wiring would).
 *
 * Every repository stores its already-validated domain record (each one is
 * zod-checked at its own real system boundary when constructed — e.g.
 * `StructuredIntelligence` via `gemini-vision-engine.ts`) as one JSON blob
 * per row (`id`, an optional `project_id` for `listByProject` filtering,
 * `data`), rather than a fully normalized per-field schema for all ~9
 * entities — deliberately: normalizing every entity into its own relational
 * shape is a separate, much larger undertaking this gate doesn't need to do
 * to deliver real durability across restarts.
 */
export class SqliteDatabase {
  readonly raw: DatabaseSyncType;

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL;');
  }

  ensureTable(table: string): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        data TEXT NOT NULL
      )
    `);
    this.raw.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_project_id ON ${table}(project_id)`);
  }

  insert(table: string, id: string, projectId: string | null, data: unknown): void {
    this.raw.prepare(`INSERT INTO ${table} (id, project_id, data) VALUES (?, ?, ?)`).run(id, projectId, JSON.stringify(data));
  }

  upsert(table: string, id: string, projectId: string | null, data: unknown): void {
    this.raw
      .prepare(
        `INSERT INTO ${table} (id, project_id, data) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, project_id = excluded.project_id`,
      )
      .run(id, projectId, JSON.stringify(data));
  }

  getById<T>(table: string, id: string): T | null {
    const row = this.raw.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : null;
  }

  listByProject<T>(table: string, projectId: string): T[] {
    const rows = this.raw.prepare(`SELECT data FROM ${table} WHERE project_id = ?`).all(projectId) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as T);
  }

  deleteById(table: string, id: string): void {
    this.raw.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  }

  close(): void {
    this.raw.close();
  }
}
