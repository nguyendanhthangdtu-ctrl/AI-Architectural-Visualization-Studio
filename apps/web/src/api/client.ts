import type { ErrorEnvelope } from '@avs/shared';
import type {
  CameraDNA,
  EditCategory,
  EditRecord,
  GenerationRecord,
  LightingDNA,
  LockId,
  MaterialDNA,
  Project,
  ProjectModule,
  VideoMotionType,
  VideoRecord,
  ViewMode,
  ViewRecord,
} from '@avs/project-core';
import type { ExtractedVisualLanguage, QCResult, ReferencePurpose, StructuredIntelligence } from '@avs/ai-core';

/**
 * Thin fetch wrapper for apps/api — docs/03 §8. Not the shared server env
 * system (packages/shared/env.ts's parseServerEnv/PublicEnv is for Node
 * process.env; this is Vite's own import.meta.env mechanism, the idiomatic
 * choice for a Vite app's build-time config). No secret lives here — the API
 * base URL is not sensitive, and this module never runs server-side.
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8080';

export class ApiError extends Error {
  readonly envelope: ErrorEnvelope;
  constructor(envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = 'ApiError';
    this.envelope = envelope;
  }
}

async function parseErrorEnvelope(res: Response): Promise<ErrorEnvelope> {
  try {
    return (await res.json()) as ErrorEnvelope;
  } catch {
    return { code: 'UNKNOWN_ERROR', message: `Request failed with status ${res.status}.`, retryable: false };
  }
}

/**
 * The wire response is plain JSON — branded fields (Timestamp, ProjectId)
 * don't survive serialization. Casting here, once, at the API boundary is
 * the deliberate place to bridge that; callers get back a real `Project`
 * and never see the untyped wire shape.
 */
export async function createProject(params: { name: string; module: ProjectModule }): Promise<Project> {
  const res = await fetch(`${API_BASE_URL}/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new ApiError(await parseErrorEnvelope(res));
  return (await res.json()) as Project;
}

export interface UploadedAsset {
  id: string;
  url: string;
  contentType: string;
  sizeBytes: number;
}

export async function uploadAsset(projectId: string, file: File): Promise<UploadedAsset> {
  const res = await fetch(`${API_BASE_URL}/projects/${projectId}/assets`, {
    method: 'POST',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!res.ok) throw new ApiError(await parseErrorEnvelope(res));
  const asset = (await res.json()) as UploadedAsset;
  return { ...asset, url: `${API_BASE_URL}${asset.url}` };
}

export interface AnalysisResult {
  analysisId: string;
  versionId: string;
  project: Project;
  structuredIntelligence: StructuredIntelligence;
}

/** docs/01 MVP step 4 "Run 12-layer AI analysis" (BUILD 07). */
export async function runAnalysis(projectId: string, assetId: string): Promise<AnalysisResult> {
  const res = await fetch(`${API_BASE_URL}/projects/${projectId}/analysis`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assetId }),
  });
  if (!res.ok) throw new ApiError(await parseErrorEnvelope(res));
  return (await res.json()) as AnalysisResult;
}

export interface ReferenceExtractionResult {
  referenceId: string;
  extractedVisualLanguage: ExtractedVisualLanguage;
}

/** docs/08 Reference Intelligence (BUILD 10) — reference image + purpose → purpose-scoped visual language. */
export async function extractReferenceVisualLanguage(
  projectId: string,
  assetId: string,
  purpose: ReferencePurpose,
): Promise<ReferenceExtractionResult> {
  const res = await fetch(`${API_BASE_URL}/projects/${projectId}/references`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assetId, purpose }),
  });
  if (!res.ok) throw new ApiError(await parseErrorEnvelope(res));
  return (await res.json()) as ReferenceExtractionResult;
}

export interface RunGenerationParams {
  promptText: string;
  renderCore: 'Nano Banana' | 'Google Flow' | 'ChatGPT Image' | 'Auto';
  aspectRatio: string;
  resolution: string;
  sourceAssetId: string;
  referenceAssetIds: string[];
  promptVersion: string;
  scenarioVersion: string;
}

export interface GenerationResult {
  jobId: string;
  generationId: string;
  versionId: string;
  project: Project;
  generation: GenerationRecord;
  outputAssetUrls: string[];
}

/** docs/11 Image Generation Pipeline (BUILD 13) — real provider call, output asset registration, provenance. */
export async function runGeneration(projectId: string, params: RunGenerationParams): Promise<GenerationResult> {
  const res = await fetch(`${API_BASE_URL}/projects/${projectId}/generations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new ApiError(await parseErrorEnvelope(res));
  const result = (await res.json()) as GenerationResult;
  return { ...result, outputAssetUrls: result.outputAssetUrls.map((url) => `${API_BASE_URL}${url}`) };
}

export interface RunEditParams {
  sourceAssetId: string;
  targetRegionDescription: string;
  intendedChange: string;
  category: EditCategory;
  maskAssetId?: string;
  protectedLocks: LockId[];
  aspectRatio: string;
  resolution: string;
}

export interface EditResult {
  jobId: string;
  editId: string;
  versionId: string;
  project: Project;
  edit: EditRecord;
  outputAssetUrls: string[];
}

/** docs/12 Advanced Editor (BUILD 14) — edits an existing generation's output via the same provider that produced it. */
export async function runEdit(projectId: string, generationId: string, params: RunEditParams): Promise<EditResult> {
  const res = await fetch(`${API_BASE_URL}/projects/${projectId}/generations/${generationId}/edits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new ApiError(await parseErrorEnvelope(res));
  const result = (await res.json()) as EditResult;
  return { ...result, outputAssetUrls: result.outputAssetUrls.map((url) => `${API_BASE_URL}${url}`) };
}

export interface RunViewParams {
  promptText: string;
  renderCore: 'Nano Banana' | 'Google Flow' | 'ChatGPT Image' | 'Auto';
  aspectRatio: string;
  resolution: string;
  sourceAssetId: string;
  referenceAssetIds: string[];
  promptVersion: string;
  scenarioVersion: string;
  mode: ViewMode;
  cameraProposal?: Partial<CameraDNA>;
  materialProposal?: Partial<MaterialDNA>;
  lightingProposal?: Partial<LightingDNA>;
  styleProposal?: string;
  ignoredProposals: string[];
}

export interface ViewResult {
  jobId: string;
  viewId: string;
  generationId: string;
  versionId: string;
  project: Project;
  view: ViewRecord;
  generation: GenerationRecord;
  outputAssetUrls: string[];
}

/** docs/13 Multi-View / Sync / Creative View (BUILD 15) — generates a new view via the same real pipeline as a normal Render. */
export async function runView(projectId: string, params: RunViewParams): Promise<ViewResult> {
  const res = await fetch(`${API_BASE_URL}/projects/${projectId}/views`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new ApiError(await parseErrorEnvelope(res));
  const result = (await res.json()) as ViewResult;
  return { ...result, outputAssetUrls: result.outputAssetUrls.map((url) => `${API_BASE_URL}${url}`) };
}

export interface RunVideoParams {
  sourceAssetId: string;
  promptText: string;
  motionType: VideoMotionType;
  motionDescription: string;
  durationSeconds: number;
  aspectRatio: string;
  resolution: string;
  renderCore: 'Veo' | 'Sora' | 'Auto';
}

export interface RunVideoResult {
  videoId: string;
  versionId: string;
  project: Project;
  video: VideoRecord;
}

export interface VideoStatusResult {
  video: VideoRecord;
  outputAssetUrl: string | null;
}

/**
 * docs/14 Image → Video (BUILD 16) — submits a genuinely asynchronous job;
 * `video.status` is `'running'` on return, not a finished result.
 */
export async function runVideo(projectId: string, generationId: string, params: RunVideoParams): Promise<RunVideoResult> {
  const res = await fetch(`${API_BASE_URL}/projects/${projectId}/generations/${generationId}/videos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new ApiError(await parseErrorEnvelope(res));
  return (await res.json()) as RunVideoResult;
}

/** Poll target for a submitted video job — callers repeat this until `video.status` leaves `'running'`. */
export async function getVideoStatus(projectId: string, videoId: string): Promise<VideoStatusResult> {
  const res = await fetch(`${API_BASE_URL}/projects/${projectId}/videos/${videoId}`);
  if (!res.ok) throw new ApiError(await parseErrorEnvelope(res));
  const result = (await res.json()) as VideoStatusResult;
  return { ...result, outputAssetUrl: result.outputAssetUrl ? `${API_BASE_URL}${result.outputAssetUrl}` : null };
}

export interface RunQcParams {
  analysisId: string;
  outputAssetId?: string;
  locks: { id: LockId; enabled: boolean }[];
  resolvedStyle?: string;
  instructions?: string[];
}

export interface RunQcResult {
  generationId: string;
  qc: QCResult;
}

/** docs/15 AI QC (BUILD 17) — VERIFY stage; scores the generation's output against its source + expected structured intent. */
export async function runQc(projectId: string, generationId: string, params: RunQcParams): Promise<RunQcResult> {
  const res = await fetch(`${API_BASE_URL}/projects/${projectId}/generations/${generationId}/qc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new ApiError(await parseErrorEnvelope(res));
  return (await res.json()) as RunQcResult;
}

export interface RunRegenerateParams extends RunGenerationParams {
  correctionInstruction: string;
}

/** docs/03 §4 VERIFY→CREATE loop (BUILD 17) — resubmits with the correction folded into the recompiled prompt. */
export async function regenerate(projectId: string, generationId: string, params: RunRegenerateParams): Promise<GenerationResult> {
  const res = await fetch(`${API_BASE_URL}/projects/${projectId}/generations/${generationId}/regenerate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new ApiError(await parseErrorEnvelope(res));
  const result = (await res.json()) as GenerationResult;
  return { ...result, outputAssetUrls: result.outputAssetUrls.map((url) => `${API_BASE_URL}${url}`) };
}
