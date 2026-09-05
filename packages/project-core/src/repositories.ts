import type { AssetId, ProjectId, UserId } from '@avs/shared';
import type { Project } from './project.js';
import type { GenerationVersion } from './version.js';
import type { LockId } from './lock.js';
import type { EditCategory } from './edit-vocabulary.js';
import type { CameraDNA, LightingDNA, MaterialDNA } from './dna.js';
import type { VideoLockId, VideoMotionType } from './video-vocabulary.js';
import type { PasswordResetToken, Session, User } from './user.js';

/**
 * Storage-agnostic repository interfaces — docs/03_TECHNICAL_ARCHITECTURE.md
 * ADR-003. Concrete implementations live in packages/storage-adapters and are
 * never referenced directly by ai-core, prompt-engine, or apps/web.
 */
export interface ProjectRepository {
  create(project: Project): Promise<Project>;
  getById(id: ProjectId): Promise<Project | null>;
  update(project: Project): Promise<Project>;
}

export interface AssetRef {
  id: AssetId;
  projectId: ProjectId;
  url: string;
  contentType: string;
  sizeBytes: number;
}

export interface AssetStore {
  put(params: { projectId: ProjectId; contentType: string; data: Uint8Array }): Promise<AssetRef>;
  get(id: AssetId): Promise<{ ref: AssetRef; data: Uint8Array } | null>;
  getSignedUrl(id: AssetId): Promise<string>;
  scheduleDeletion(id: AssetId): Promise<void>;
}

export interface VersionRepository {
  create(version: GenerationVersion): Promise<GenerationVersion>;
  getById(id: string): Promise<GenerationVersion | null>;
  listByProject(projectId: ProjectId): Promise<GenerationVersion[]>;
}

/**
 * Generation job records — docs/04_DATA_MODEL.md Generation. Kept as a
 * separate repository from VersionRepository since a Generation carries
 * provider/job-specific fields beyond the version DAG's structural fields.
 */
export interface GenerationRepository {
  create(generation: GenerationRecord): Promise<GenerationRecord>;
  getById(id: string): Promise<GenerationRecord | null>;
  updateStatus(id: string, status: GenerationRecord['status']): Promise<GenerationRecord>;
}

/**
 * docs/04_DATA_MODEL.md "Analysis" entity — the persisted result of a
 * Vision Analysis Engine run (BUILD 07, packages/ai-core). `structuredIntelligence`
 * is intentionally `unknown` here: project-core must not depend on ai-core
 * (docs/03 §3 dependency direction), so this repository stores the shape
 * opaquely — apps/api, which depends on both, is the layer that casts it
 * back to ai-core's real `StructuredIntelligence` type when reading.
 */
export interface AnalysisRecord {
  id: string;
  projectId: ProjectId;
  sourceAssetId: AssetId;
  analysisVersion: string;
  structuredIntelligence: unknown;
  createdAt: string;
}

export interface AnalysisRepository {
  create(analysis: AnalysisRecord): Promise<AnalysisRecord>;
  getById(id: string): Promise<AnalysisRecord | null>;
}

/**
 * docs/04_DATA_MODEL.md "Reference" entity — the persisted result of a
 * Reference Intelligence extraction (BUILD 10, packages/ai-core).
 * `extractedVisualLanguage` is intentionally `unknown` here for the same
 * dependency-direction reason as `AnalysisRecord.structuredIntelligence`:
 * project-core must not depend on ai-core. `extractedPrompt` stays nullable —
 * compiling a full prompt from a reference is the Master Prompt Compiler's
 * job (BUILD 11), not this gate's; `constraints` is a reserved, currently-
 * empty bag for the future Reference Mixer (docs/08), not yet implemented.
 */
export interface ReferenceRecord {
  id: string;
  projectId: ProjectId;
  assetId: AssetId;
  purpose: string;
  extractedVisualLanguage: unknown;
  extractedPrompt: string | null;
  weight: number;
  constraints: Record<string, unknown>;
  createdAt: string;
}

export interface ReferenceRepository {
  create(reference: ReferenceRecord): Promise<ReferenceRecord>;
  getById(id: string): Promise<ReferenceRecord | null>;
  listByProject(projectId: ProjectId): Promise<ReferenceRecord[]>;
}

export type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface GenerationRecord {
  id: string;
  projectId: ProjectId;
  viewId: string | null;
  provider: string;
  model: string;
  promptVersion: string;
  scenarioVersion: string;
  sourceAssets: AssetId[];
  referenceAssets: AssetId[];
  status: GenerationStatus;
  outputAssets: AssetId[];
  usageMetadata: Record<string, unknown>;
}

/**
 * docs/12_EDITOR_SPEC.md Advanced Editor (BUILD 14) — "Each edit must
 * declare: target region, intended change, protected regions/locks, parent
 * generation, resulting asset," mapped 1:1 onto fields below.
 * `targetRegionDescription` is always present (text — the current, real
 * input mechanism); `maskAssetId` is populated only when a real pixel mask
 * was supplied (no freehand mask-drawing UI exists yet — BUILD 14 scope).
 * `protectedLocks` records which locks were enabled at edit time — supplied
 * by the caller, since lock state is never persisted server-side (it lives
 * only in client `ProjectSessionState`, same as every lock-consuming route
 * since BUILD 08).
 */
export interface EditRecord {
  id: string;
  projectId: ProjectId;
  parentGenerationId: string;
  sourceAssetId: AssetId;
  targetRegionDescription: string;
  maskAssetId: AssetId | null;
  intendedChange: string;
  category: EditCategory;
  protectedLocks: LockId[];
  resultingAssetId: AssetId | null;
  status: GenerationStatus;
  usageMetadata: Record<string, unknown>;
  createdAt: string;
}

export interface EditRepository {
  create(edit: EditRecord): Promise<EditRecord>;
  getById(id: string): Promise<EditRecord | null>;
  listByProject(projectId: ProjectId): Promise<EditRecord[]>;
}

/** docs/13_MULTIVIEW_SPEC.md (BUILD 15) — 'sync' preserves Project DNA/locked attributes except camera; 'creative' preserves only Architecture DNA. */
export type ViewMode = 'sync' | 'creative';

/**
 * docs/13_MULTIVIEW_SPEC.md "Version tree: every view/generation is linked
 * to its parent version and project snapshot." Unlike `AnalysisRecord`/
 * `ReferenceRecord`, the proposal fields here are typed precisely, not
 * `unknown` — `CameraDNA`/`MaterialDNA`/`LightingDNA` already live in
 * project-core (dna.ts), so no ai-core dependency-direction issue applies.
 * `ignoredProposals` records what a Sync View structurally refused to apply
 * (docs/13 "preserving... locked attributes") — real provenance, not silent.
 */
export interface ViewRecord {
  id: string;
  projectId: ProjectId;
  mode: ViewMode;
  cameraProposal: Partial<CameraDNA> | null;
  materialProposal: Partial<MaterialDNA> | null;
  lightingProposal: Partial<LightingDNA> | null;
  styleProposal: string | null;
  ignoredProposals: string[];
  parentVersionId: string | null;
  resultingGenerationId: string | null;
  createdAt: string;
}

export interface ViewRepository {
  create(view: ViewRecord): Promise<ViewRecord>;
  getById(id: string): Promise<ViewRecord | null>;
  listByProject(projectId: ProjectId): Promise<ViewRecord[]>;
}

/**
 * docs/14_VIDEO_SPEC.md Image → Video (BUILD 16) — "Input: final image +
 * Project DNA + motion plan." `protectedLocks` is always the full
 * `VIDEO_LOCK_IDS` set (video-vocabulary.ts) — docs/14 names these as fixed
 * guarantees, not per-request user choices, unlike the 5 image Locks.
 * `providerOperationName`/`status` track the real asynchronous
 * submit-then-poll lifecycle (docs/11 "long-running operations must be
 * asynchronous") — genuinely different from `GenerationRecord`, which BUILD
 * 13-15 always resolved synchronously within one request.
 */
export interface VideoRecord {
  id: string;
  projectId: ProjectId;
  parentGenerationId: string;
  sourceAssetId: AssetId;
  motionType: VideoMotionType;
  motionDescription: string;
  durationSeconds: number;
  protectedLocks: VideoLockId[];
  provider: string;
  providerOperationName: string | null;
  status: GenerationStatus;
  resultingAssetId: AssetId | null;
  usageMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface VideoRepository {
  create(video: VideoRecord): Promise<VideoRecord>;
  getById(id: string): Promise<VideoRecord | null>;
  update(video: VideoRecord): Promise<VideoRecord>;
  listByProject(projectId: ProjectId): Promise<VideoRecord[]>;
}

/**
 * docs/03 §9 "Audit log (append-only) for: lock enable/disable, destructive/
 * regenerate actions, deletions, asset access grants" (BUILD 18 hardening —
 * this requirement existed since §9 was first written but had zero
 * implementation until now). Lock changes aren't audited yet: locks are
 * still resolved entirely client-side (no `PATCH /projects/:id/locks` route
 * exists — a pre-existing, already-documented gap, not introduced here);
 * this repository covers the operations that DO have a real server-side
 * route today (asset access, regenerate, asset deletion).
 */
export interface AuditEvent {
  id: string;
  action: string;
  /** No auth exists yet (every BUILD gate's "no auth yet, BUILD 02 deferral" caveat) — always 'anonymous' until real auth exists. */
  actorId: string;
  projectId: ProjectId | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogRepository {
  record(event: AuditEvent): Promise<AuditEvent>;
  listByProject(projectId: ProjectId): Promise<AuditEvent[]>;
}

/** RELEASE 02 — real accounts. `email` lookups are case-insensitive (enforced by the implementation, not this interface). */
export interface UserRepository {
  create(user: User): Promise<User>;
  getById(id: UserId): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  /** BUILD 19 (Account Recovery) — the one field a password reset ever changes; never a general-purpose profile update. */
  updatePasswordHash(id: UserId, passwordHash: string): Promise<void>;
}

/**
 * RELEASE 02 — real, revocable server-side sessions (see `Session`'s own doc
 * comment, user.ts). `deleteAllForUser` (BUILD 19) is what makes a password
 * reset actually revoke every existing session, not just the one the reset
 * happened to arrive through.
 */
export interface SessionRepository {
  create(session: Session): Promise<Session>;
  getById(id: string): Promise<Session | null>;
  deleteById(id: string): Promise<void>;
  deleteAllForUser(userId: UserId): Promise<void>;
}

/** BUILD 19 (Account Recovery) — see `PasswordResetToken`'s own doc comment, user.ts. */
export interface PasswordResetTokenRepository {
  create(token: PasswordResetToken): Promise<PasswordResetToken>;
  getById(tokenHash: string): Promise<PasswordResetToken | null>;
  markUsed(tokenHash: string, usedAt: string): Promise<void>;
}
