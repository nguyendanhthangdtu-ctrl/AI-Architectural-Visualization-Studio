import { DomainError } from '@avs/shared';
import type { ProjectId, UserId } from '@avs/shared';
import type {
  AnalysisRecord,
  AnalysisRepository,
  AuditEvent,
  AuditLogRepository,
  EditRecord,
  EditRepository,
  GenerationRecord,
  GenerationRepository,
  GenerationVersion,
  Project,
  ProjectRepository,
  ReferenceRecord,
  ReferenceRepository,
  Session,
  SessionRepository,
  User,
  UserRepository,
  VersionRepository,
  VideoRecord,
  VideoRepository,
  ViewRecord,
  ViewRepository,
} from '@avs/project-core';
import type { SqliteDatabase } from './sqlite-database.js';

/**
 * `node:sqlite`-backed repository implementations — BUILD 18 (see
 * sqlite-database.ts for the storage-engine rationale). Each class mirrors
 * its `InMemory*` predecessor's exact semantics (same not-found errors, same
 * method signatures) so swapping `app-context.ts`'s wiring is the only
 * caller-visible change (docs/03 ADR-003).
 */

const PROJECTS_TABLE = 'projects';
const VERSIONS_TABLE = 'versions';
const ANALYSES_TABLE = 'analyses';
const REFERENCES_TABLE = 'reference_records';
const GENERATIONS_TABLE = 'generations';
const EDITS_TABLE = 'edits';
const VIEWS_TABLE = 'view_records';
const VIDEOS_TABLE = 'videos';
const AUDIT_EVENTS_TABLE = 'audit_events';
const SESSIONS_TABLE = 'sessions';

export class SqliteProjectRepository implements ProjectRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.ensureTable(PROJECTS_TABLE);
  }

  async create(project: Project): Promise<Project> {
    this.db.insert(PROJECTS_TABLE, project.id, null, project);
    return project;
  }

  async getById(id: ProjectId): Promise<Project | null> {
    return this.db.getById<Project>(PROJECTS_TABLE, id);
  }

  async update(project: Project): Promise<Project> {
    if (!(await this.getById(project.id))) {
      throw new DomainError({ code: 'PROJECT_NOT_FOUND', message: `No project with id ${project.id}`, retryable: false });
    }
    this.db.upsert(PROJECTS_TABLE, project.id, null, project);
    return project;
  }
}

export class SqliteVersionRepository implements VersionRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.ensureTable(VERSIONS_TABLE);
  }

  async create(version: GenerationVersion): Promise<GenerationVersion> {
    this.db.insert(VERSIONS_TABLE, version.id, version.projectId, version);
    return version;
  }

  async getById(id: string): Promise<GenerationVersion | null> {
    return this.db.getById<GenerationVersion>(VERSIONS_TABLE, id);
  }

  async listByProject(projectId: ProjectId): Promise<GenerationVersion[]> {
    return this.db.listByProject<GenerationVersion>(VERSIONS_TABLE, projectId);
  }
}

export class SqliteAnalysisRepository implements AnalysisRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.ensureTable(ANALYSES_TABLE);
  }

  async create(analysis: AnalysisRecord): Promise<AnalysisRecord> {
    this.db.insert(ANALYSES_TABLE, analysis.id, analysis.projectId, analysis);
    return analysis;
  }

  async getById(id: string): Promise<AnalysisRecord | null> {
    return this.db.getById<AnalysisRecord>(ANALYSES_TABLE, id);
  }
}

export class SqliteReferenceRepository implements ReferenceRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.ensureTable(REFERENCES_TABLE);
  }

  async create(reference: ReferenceRecord): Promise<ReferenceRecord> {
    this.db.insert(REFERENCES_TABLE, reference.id, reference.projectId, reference);
    return reference;
  }

  async getById(id: string): Promise<ReferenceRecord | null> {
    return this.db.getById<ReferenceRecord>(REFERENCES_TABLE, id);
  }

  async listByProject(projectId: ProjectId): Promise<ReferenceRecord[]> {
    return this.db.listByProject<ReferenceRecord>(REFERENCES_TABLE, projectId);
  }
}

export class SqliteGenerationRepository implements GenerationRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.ensureTable(GENERATIONS_TABLE);
  }

  async create(generation: GenerationRecord): Promise<GenerationRecord> {
    this.db.insert(GENERATIONS_TABLE, generation.id, generation.projectId, generation);
    return generation;
  }

  async getById(id: string): Promise<GenerationRecord | null> {
    return this.db.getById<GenerationRecord>(GENERATIONS_TABLE, id);
  }

  async updateStatus(id: string, status: GenerationRecord['status']): Promise<GenerationRecord> {
    const record = await this.getById(id);
    if (!record) {
      throw new DomainError({ code: 'GENERATION_NOT_FOUND', message: `No generation with id ${id}`, retryable: false });
    }
    const updated = { ...record, status };
    this.db.upsert(GENERATIONS_TABLE, id, updated.projectId, updated);
    return updated;
  }
}

export class SqliteEditRepository implements EditRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.ensureTable(EDITS_TABLE);
  }

  async create(edit: EditRecord): Promise<EditRecord> {
    this.db.insert(EDITS_TABLE, edit.id, edit.projectId, edit);
    return edit;
  }

  async getById(id: string): Promise<EditRecord | null> {
    return this.db.getById<EditRecord>(EDITS_TABLE, id);
  }

  async listByProject(projectId: ProjectId): Promise<EditRecord[]> {
    return this.db.listByProject<EditRecord>(EDITS_TABLE, projectId);
  }
}

export class SqliteViewRepository implements ViewRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.ensureTable(VIEWS_TABLE);
  }

  async create(view: ViewRecord): Promise<ViewRecord> {
    this.db.insert(VIEWS_TABLE, view.id, view.projectId, view);
    return view;
  }

  async getById(id: string): Promise<ViewRecord | null> {
    return this.db.getById<ViewRecord>(VIEWS_TABLE, id);
  }

  async listByProject(projectId: ProjectId): Promise<ViewRecord[]> {
    return this.db.listByProject<ViewRecord>(VIEWS_TABLE, projectId);
  }
}

export class SqliteVideoRepository implements VideoRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.ensureTable(VIDEOS_TABLE);
  }

  async create(video: VideoRecord): Promise<VideoRecord> {
    this.db.insert(VIDEOS_TABLE, video.id, video.projectId, video);
    return video;
  }

  async getById(id: string): Promise<VideoRecord | null> {
    return this.db.getById<VideoRecord>(VIDEOS_TABLE, id);
  }

  async update(video: VideoRecord): Promise<VideoRecord> {
    if (!(await this.getById(video.id))) {
      throw new DomainError({ code: 'VIDEO_NOT_FOUND', message: `No video with id ${video.id}`, retryable: false });
    }
    this.db.upsert(VIDEOS_TABLE, video.id, video.projectId, video);
    return video;
  }

  async listByProject(projectId: ProjectId): Promise<VideoRecord[]> {
    return this.db.listByProject<VideoRecord>(VIDEOS_TABLE, projectId);
  }
}

export class SqliteAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.ensureTable(AUDIT_EVENTS_TABLE);
  }

  async record(event: AuditEvent): Promise<AuditEvent> {
    this.db.insert(AUDIT_EVENTS_TABLE, event.id, event.projectId, event);
    return event;
  }

  async listByProject(projectId: ProjectId): Promise<AuditEvent[]> {
    return this.db.listByProject<AuditEvent>(AUDIT_EVENTS_TABLE, projectId);
  }
}

/**
 * RELEASE 02 — real accounts. Users aren't project-scoped (no meaningful
 * `project_id`), and need a real unique-by-email lookup the generic
 * id/project_id/data table shape doesn't provide — so this owns a small,
 * bespoke table (`users`) directly on `db.raw` rather than reusing
 * `SqliteDatabase`'s generic JSON-blob helpers.
 */
export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: SqliteDatabase) {
    this.db.raw.exec(
      `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, data TEXT NOT NULL)`,
    );
  }

  async create(user: User): Promise<User> {
    const existing = await this.getByEmail(user.email);
    if (existing) {
      throw new DomainError({ code: 'EMAIL_ALREADY_REGISTERED', message: 'An account with this email already exists.', retryable: false });
    }
    this.db.raw
      .prepare(`INSERT INTO users (id, email, data) VALUES (?, ?, ?)`)
      .run(user.id, user.email.toLowerCase(), JSON.stringify(user));
    return user;
  }

  async getById(id: UserId): Promise<User | null> {
    const row = this.db.raw.prepare(`SELECT data FROM users WHERE id = ?`).get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as User) : null;
  }

  async getByEmail(email: string): Promise<User | null> {
    const row = this.db.raw.prepare(`SELECT data FROM users WHERE email = ?`).get(email.toLowerCase()) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as User) : null;
  }
}

/** RELEASE 02 — real, revocable sessions; fits the generic id/project_id/data shape (`project_id` stays unused/null). */
export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.ensureTable(SESSIONS_TABLE);
  }

  async create(session: Session): Promise<Session> {
    this.db.insert(SESSIONS_TABLE, session.id, null, session);
    return session;
  }

  async getById(id: string): Promise<Session | null> {
    return this.db.getById<Session>(SESSIONS_TABLE, id);
  }

  async deleteById(id: string): Promise<void> {
    this.db.deleteById(SESSIONS_TABLE, id);
  }
}

