import { DomainError } from '@avs/shared';
import type { AssetId, ProjectId } from '@avs/shared';
import type {
  AnalysisRecord,
  AnalysisRepository,
  AssetRef,
  AssetStore,
  EditRecord,
  EditRepository,
  GenerationRecord,
  GenerationRepository,
  Project,
  ProjectRepository,
  GenerationVersion,
  ReferenceRecord,
  ReferenceRepository,
  VersionRepository,
  ViewRecord,
  ViewRepository,
  VideoRecord,
  VideoRepository,
} from '@avs/project-core';

/**
 * In-memory reference implementations — dev/test only, not a production
 * datastore. Concrete relational/blob vendors are deferred to BUILD 02
 * confirmation of ADR-005 (docs/03_TECHNICAL_ARCHITECTURE.md §13); this class
 * is intentionally named to make that scope explicit, not to imply a real
 * production integration (CLAUDE.md rule 7).
 */
export class InMemoryProjectRepository implements ProjectRepository {
  private readonly store = new Map<string, Project>();

  async create(project: Project): Promise<Project> {
    this.store.set(project.id, project);
    return project;
  }

  async getById(id: ProjectId): Promise<Project | null> {
    return this.store.get(id) ?? null;
  }

  async update(project: Project): Promise<Project> {
    if (!this.store.has(project.id)) {
      throw new DomainError({
        code: 'PROJECT_NOT_FOUND',
        message: `No project with id ${project.id}`,
        retryable: false,
      });
    }
    this.store.set(project.id, project);
    return project;
  }
}

export class InMemoryAssetStore implements AssetStore {
  private readonly refs = new Map<string, AssetRef>();
  private readonly bytes = new Map<string, Uint8Array>();
  private counter = 0;

  async put(params: { projectId: ProjectId; contentType: string; data: Uint8Array }): Promise<AssetRef> {
    this.counter += 1;
    const id = `asset-${this.counter}` as AssetId;
    const ref: AssetRef = {
      id,
      projectId: params.projectId,
      url: `memory://assets/${id}`,
      contentType: params.contentType,
      sizeBytes: params.data.byteLength,
    };
    this.refs.set(id, ref);
    this.bytes.set(id, params.data);
    return ref;
  }

  async get(id: AssetId): Promise<{ ref: AssetRef; data: Uint8Array } | null> {
    const ref = this.refs.get(id);
    const data = this.bytes.get(id);
    if (!ref || !data) return null;
    return { ref, data };
  }

  async getSignedUrl(id: AssetId): Promise<string> {
    const ref = this.refs.get(id);
    if (!ref) {
      throw new DomainError({ code: 'ASSET_NOT_FOUND', message: `No asset with id ${id}`, retryable: false });
    }
    return ref.url;
  }

  async scheduleDeletion(id: AssetId): Promise<void> {
    this.refs.delete(id);
    this.bytes.delete(id);
  }
}

export class InMemoryVersionRepository implements VersionRepository {
  private readonly store = new Map<string, GenerationVersion>();

  async create(version: GenerationVersion): Promise<GenerationVersion> {
    this.store.set(version.id, version);
    return version;
  }

  async getById(id: string): Promise<GenerationVersion | null> {
    return this.store.get(id) ?? null;
  }

  async listByProject(projectId: ProjectId): Promise<GenerationVersion[]> {
    return [...this.store.values()].filter((v) => v.projectId === projectId);
  }
}

export class InMemoryAnalysisRepository implements AnalysisRepository {
  private readonly store = new Map<string, AnalysisRecord>();

  async create(analysis: AnalysisRecord): Promise<AnalysisRecord> {
    this.store.set(analysis.id, analysis);
    return analysis;
  }

  async getById(id: string): Promise<AnalysisRecord | null> {
    return this.store.get(id) ?? null;
  }
}

export class InMemoryReferenceRepository implements ReferenceRepository {
  private readonly store = new Map<string, ReferenceRecord>();

  async create(reference: ReferenceRecord): Promise<ReferenceRecord> {
    this.store.set(reference.id, reference);
    return reference;
  }

  async getById(id: string): Promise<ReferenceRecord | null> {
    return this.store.get(id) ?? null;
  }

  async listByProject(projectId: ProjectId): Promise<ReferenceRecord[]> {
    return [...this.store.values()].filter((r) => r.projectId === projectId);
  }
}

export class InMemoryGenerationRepository implements GenerationRepository {
  private readonly store = new Map<string, GenerationRecord>();

  async create(generation: GenerationRecord): Promise<GenerationRecord> {
    this.store.set(generation.id, generation);
    return generation;
  }

  async getById(id: string): Promise<GenerationRecord | null> {
    return this.store.get(id) ?? null;
  }

  async updateStatus(id: string, status: GenerationRecord['status']): Promise<GenerationRecord> {
    const record = this.store.get(id);
    if (!record) {
      throw new DomainError({ code: 'GENERATION_NOT_FOUND', message: `No generation with id ${id}`, retryable: false });
    }
    const updated = { ...record, status };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryEditRepository implements EditRepository {
  private readonly store = new Map<string, EditRecord>();

  async create(edit: EditRecord): Promise<EditRecord> {
    this.store.set(edit.id, edit);
    return edit;
  }

  async getById(id: string): Promise<EditRecord | null> {
    return this.store.get(id) ?? null;
  }

  async listByProject(projectId: ProjectId): Promise<EditRecord[]> {
    return [...this.store.values()].filter((e) => e.projectId === projectId);
  }
}

export class InMemoryViewRepository implements ViewRepository {
  private readonly store = new Map<string, ViewRecord>();

  async create(view: ViewRecord): Promise<ViewRecord> {
    this.store.set(view.id, view);
    return view;
  }

  async getById(id: string): Promise<ViewRecord | null> {
    return this.store.get(id) ?? null;
  }

  async listByProject(projectId: ProjectId): Promise<ViewRecord[]> {
    return [...this.store.values()].filter((v) => v.projectId === projectId);
  }
}

export class InMemoryVideoRepository implements VideoRepository {
  private readonly store = new Map<string, VideoRecord>();

  async create(video: VideoRecord): Promise<VideoRecord> {
    this.store.set(video.id, video);
    return video;
  }

  async getById(id: string): Promise<VideoRecord | null> {
    return this.store.get(id) ?? null;
  }

  async update(video: VideoRecord): Promise<VideoRecord> {
    if (!this.store.has(video.id)) {
      throw new DomainError({ code: 'VIDEO_NOT_FOUND', message: `No video with id ${video.id}`, retryable: false });
    }
    this.store.set(video.id, video);
    return video;
  }

  async listByProject(projectId: ProjectId): Promise<VideoRecord[]> {
    return [...this.store.values()].filter((v) => v.projectId === projectId);
  }
}
