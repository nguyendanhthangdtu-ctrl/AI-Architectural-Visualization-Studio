import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AssetId, ProjectId, Timestamp } from '@avs/shared';
import { DomainError } from '@avs/shared';
import type { StructuredIntelligence } from '@avs/ai-core';
import { deriveProjectDNA } from '@avs/ai-core';
import type {
  AnalysisRecord,
  AssetRef,
  EditRecord,
  GenerationRecord,
  GenerationVersion,
  Project,
  ReferenceRecord,
  ViewRecord,
  VideoRecord,
} from '@avs/project-core';
import { VIDEO_LOCK_IDS } from '@avs/project-core';
import type {
  GenerationResult,
  ImageGenerationAdapter,
  RenderCoreSelection,
  VideoRenderCoreSelection,
} from '@avs/model-adapters';
import type { AppContext } from './app-context.js';
import type { JobRecord } from './job-queue.js';
import {
  createProjectRequestSchema,
  runAnalysisRequestSchema,
  runEditRequestSchema,
  runGenerationRequestSchema,
  runQcRequestSchema,
  runReferenceExtractionRequestSchema,
  runRegenerateRequestSchema,
  runVideoRequestSchema,
  runViewRequestSchema,
  type RunGenerationRequest,
  type RunVideoRequest,
} from './schemas.js';
import { readBody } from './read-body.js';
import { isAllowedContentType, MAX_IMAGE_DIMENSION_PX, MAX_UPLOAD_SIZE_BYTES, readImageDimensions, validateUpload } from './upload-validation.js';
import { buildAssetUrl } from './signed-asset-url.js';
import { sendJson } from './http-utils.js';
import type { AuthenticatedUser } from '@avs/project-core';

const MAX_JSON_BODY_BYTES = 10 * 1024; // project create/update payloads are small, fixed-shape JSON
const MAX_GENERATION_BODY_BYTES = 50 * 1024; // a compiled master prompt + reference id list is larger than other JSON bodies here

/**
 * RELEASE 02 — the one real authorization check every project-scoped route
 * calls through: `ownerId` always comes from the session-derived `user`
 * (never a client-supplied id), and a project that exists but belongs to
 * someone else returns the exact same `PROJECT_NOT_FOUND` as one that
 * doesn't exist at all — never leaks existence to a non-owner (IDOR-safe).
 */
async function resolveOwnedProjectOrThrow(context: AppContext, projectId: string, user: AuthenticatedUser): Promise<Project> {
  const project = await context.projectRepository.getById(projectId as ProjectId);
  if (!project || project.ownerId !== user.id) {
    throw new DomainError({ code: 'PROJECT_NOT_FOUND', message: `No project with id ${projectId}`, retryable: false });
  }
  return project;
}

/** docs/01 MVP step 1 "Create project" + step 3 "Select Architecture or Interior". */
export async function handleCreateProject(
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext,
  user: AuthenticatedUser,
): Promise<void> {
  const raw = await readBody(req, MAX_JSON_BODY_BYTES);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new DomainError({ code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.', retryable: false });
  }

  const result = createProjectRequestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid project payload: ${result.error.issues.map((i) => i.message).join('; ')}`,
      retryable: false,
    });
  }

  const now = new Date().toISOString() as Timestamp;
  const project: Project = {
    id: randomUUID() as ProjectId,
    ownerId: user.id,
    name: result.data.name,
    module: result.data.module,
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    // No GenerationVersion exists yet — the first one (kind: 'analysis') is created at BUILD 07.
    currentVersionId: '',
  };

  const created = await context.projectRepository.create(project);
  sendJson(res, 201, created);
}

export async function handleGetProject(
  res: ServerResponse,
  context: AppContext,
  user: AuthenticatedUser,
  projectId: string,
): Promise<void> {
  const project = await resolveOwnedProjectOrThrow(context, projectId, user);
  sendJson(res, 200, project);
}

/** docs/01 MVP step 2 "Upload SketchUp/3ds Max viewport" — docs/16 validates type/size/dimensions first. */
export async function handleUploadAsset(
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext,
  user: AuthenticatedUser,
  projectId: string,
): Promise<void> {
  await resolveOwnedProjectOrThrow(context, projectId, user);

  const contentType = req.headers['content-type'];
  const data = await readBody(req, MAX_UPLOAD_SIZE_BYTES);
  validateUpload({ contentType, sizeBytes: data.length, data });

  const ref = await context.assetStore.put({ projectId: projectId as ProjectId, contentType: contentType!, data });
  sendJson(res, 201, {
    id: ref.id,
    url: buildAssetUrl(context.assetUrlSigner, ref.id),
    contentType: ref.contentType,
    sizeBytes: ref.sizeBytes,
  });
}

/**
 * docs/01 MVP step 4 "Run 12-layer AI analysis" — docs/03 ADR-006: creates a
 * new `analysis` GenerationVersion and advances Project.currentVersionId,
 * never mutating a prior version in place.
 */
export async function handleRunAnalysis(
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext,
  user: AuthenticatedUser,
  projectId: string,
): Promise<void> {
  const project = await resolveOwnedProjectOrThrow(context, projectId, user);

  const raw = await readBody(req, MAX_JSON_BODY_BYTES);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new DomainError({ code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.', retryable: false });
  }
  const result = runAnalysisRequestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid analysis request: ${result.error.issues.map((i) => i.message).join('; ')}`,
      retryable: false,
    });
  }

  const asset = await context.assetStore.get(result.data.assetId as AssetId);
  if (!asset || asset.ref.projectId !== project.id) {
    throw new DomainError({
      code: 'ASSET_NOT_FOUND',
      message: `No asset with id ${result.data.assetId} on project ${projectId}`,
      retryable: false,
    });
  }

  const structuredIntelligence = await context.visionAnalysisEngine.analyze(
    { assetId: asset.ref.id, data: asset.data, contentType: asset.ref.contentType },
    project.module,
  );

  const now = new Date().toISOString();
  const analysisRecord: AnalysisRecord = {
    id: randomUUID(),
    projectId: project.id,
    sourceAssetId: asset.ref.id,
    analysisVersion: structuredIntelligence.analysisVersion,
    structuredIntelligence,
    createdAt: now,
  };
  await context.analysisRepository.create(analysisRecord);

  const version: GenerationVersion = {
    id: randomUUID(),
    projectId: project.id,
    parentVersionId: project.currentVersionId || null,
    kind: 'analysis',
    snapshotRef: analysisRecord.id,
    createdAt: now as Timestamp,
    createdBy: user.id,
  };
  await context.versionRepository.create(version);

  const updatedProject = await context.projectRepository.update({
    ...project,
    currentVersionId: version.id,
    updatedAt: now as Timestamp,
  });

  sendJson(res, 201, {
    analysisId: analysisRecord.id,
    versionId: version.id,
    project: updatedProject,
    structuredIntelligence,
  });
}

/**
 * docs/02 UX "Reference image and reference purpose" / docs/08 Reference
 * Intelligence (BUILD 10). Unlike analysis, a reference extraction does not
 * create a GenerationVersion — docs/04's "Reference" entity is scoped to a
 * project, not the version DAG (only `Analysis`/`Generation` events are; see
 * docs/03 ADR-006), so this only creates a `ReferenceRecord`.
 */
export async function handleExtractReference(
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext,
  user: AuthenticatedUser,
  projectId: string,
): Promise<void> {
  const project = await resolveOwnedProjectOrThrow(context, projectId, user);

  const raw = await readBody(req, MAX_JSON_BODY_BYTES);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new DomainError({ code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.', retryable: false });
  }
  const result = runReferenceExtractionRequestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid reference extraction request: ${result.error.issues.map((i) => i.message).join('; ')}`,
      retryable: false,
    });
  }

  const asset = await context.assetStore.get(result.data.assetId as AssetId);
  if (!asset || asset.ref.projectId !== project.id) {
    throw new DomainError({
      code: 'ASSET_NOT_FOUND',
      message: `No asset with id ${result.data.assetId} on project ${projectId}`,
      retryable: false,
    });
  }

  const extracted = await context.referenceIntelligenceEngine.extract(
    { assetId: asset.ref.id, data: asset.data, contentType: asset.ref.contentType },
    result.data.purpose,
  );
  const extractedVisualLanguage = { ...extracted, weight: result.data.weight ?? extracted.weight };

  const referenceRecord: ReferenceRecord = {
    id: randomUUID(),
    projectId: project.id,
    assetId: asset.ref.id,
    purpose: result.data.purpose,
    extractedVisualLanguage,
    extractedPrompt: null,
    weight: extractedVisualLanguage.weight,
    constraints: {},
    createdAt: new Date().toISOString(),
  };
  await context.referenceRepository.create(referenceRecord);

  sendJson(res, 201, { referenceId: referenceRecord.id, extractedVisualLanguage });
}

const RENDER_CORE_SELECTION: Record<RunGenerationRequest['renderCore'], RenderCoreSelection> = {
  'Nano Banana': 'nano-banana',
  'Nano Banana Pro': 'nano-banana-pro',
  'Google Flow': 'google-flow',
  'ChatGPT Image': 'chatgpt-image',
  Auto: 'auto',
};

/**
 * Decodes the `data:` URI a real adapter returns (BUILD 12) back into raw
 * bytes for `AssetStore.put()`. Shared by image outputs (generation/edit) AND
 * video outputs (Veo download, `video/mp4`) — this generic layer only checks
 * the shape is real (a real `data:` URI, non-empty bytes); it never assumes
 * "image," since a video is a perfectly valid, expected output here too.
 * Format-specific validation (decodability, dimensions) is `validateImageOutput()`'s job, applied only at the two image call sites.
 */
function decodeDataUri(uri: string): { contentType: string; data: Uint8Array } {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(uri);
  if (!match) {
    throw new DomainError({
      code: 'GENERATION_OUTPUT_INVALID',
      message: 'Adapter returned an output that was not a data: URI.',
      retryable: false,
    });
  }
  const contentType = match[1]!;
  const data = new Uint8Array(Buffer.from(match[2]!, 'base64'));

  if (data.length === 0) {
    throw new DomainError({
      code: 'GENERATION_OUTPUT_INVALID',
      message: 'Adapter returned an empty output payload.',
      retryable: false,
    });
  }

  return { contentType, data };
}

/**
 * BUILD 21 Phase 4 (Image Input/Output Pipeline) — validates a decoded
 * generation/edit output is a real, decodable image before it ever reaches
 * `AssetStore.put()`: a recognized image content type and parseable
 * dimensions within the same sane bound upload validation already enforces
 * (`readImageDimensions`, `upload-validation.ts` — reused, not duplicated,
 * CLAUDE.md rule 9). A provider that returns text/an error/a truncated or
 * corrupt payload instead of a real image is rejected here with a typed
 * error, never silently persisted as a bogus "generated" asset. Not applied
 * to video output (`video/mp4` is a valid, expected non-image content type).
 */
function validateImageOutput(decoded: { contentType: string; data: Uint8Array }): { contentType: string; data: Uint8Array } {
  if (!isAllowedContentType(decoded.contentType)) {
    throw new DomainError({
      code: 'GENERATION_OUTPUT_INVALID',
      message: `Adapter returned an unrecognized output content type "${decoded.contentType}".`,
      retryable: false,
    });
  }
  const dimensions = readImageDimensions(decoded.contentType, decoded.data);
  if (!dimensions) {
    throw new DomainError({
      code: 'GENERATION_OUTPUT_INVALID',
      message: `Adapter's output could not be decoded as a valid "${decoded.contentType}" image.`,
      retryable: false,
    });
  }
  if (dimensions.width > MAX_IMAGE_DIMENSION_PX || dimensions.height > MAX_IMAGE_DIMENSION_PX) {
    throw new DomainError({
      code: 'GENERATION_OUTPUT_INVALID',
      message: `Adapter's output is ${dimensions.width}x${dimensions.height}px, exceeding the ${MAX_IMAGE_DIMENSION_PX}px limit per side.`,
      retryable: false,
    });
  }
  return decoded;
}

/**
 * zod's `.partial()` types an omitted key as `T | undefined`, which fails
 * `exactOptionalPropertyTypes` against `Partial<CameraDNA>` (whose fields are
 * `X | null`, never `X | null | undefined`) even though a genuinely-absent
 * key is exactly what "partial" means at runtime — this drops any key that
 * parsed as `undefined` so the object satisfies the stricter domain type.
 */
function omitUndefinedKeys<T extends object>(obj: T | undefined): { [K in keyof T]?: Exclude<T[K], undefined> } | null {
  if (obj === undefined) return null;
  const entries = Object.entries(obj).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

async function resolveAssetOrThrow(
  context: AppContext,
  project: Project,
  assetId: string,
  label: string,
): Promise<{ ref: AssetRef; data: Uint8Array }> {
  const asset = await context.assetStore.get(assetId as AssetId);
  if (!asset || asset.ref.projectId !== project.id) {
    throw new DomainError({
      code: 'ASSET_NOT_FOUND',
      message: `No ${label} with id ${assetId} on project ${project.id}`,
      retryable: false,
    });
  }
  return asset;
}

/**
 * Shared by `/generations` and `/views` (BUILD 15) — both submit an
 * already-compiled prompt (BUILD 11) to a real provider adapter (BUILD 12/13)
 * and track the job the same way; they differ only in what `GenerationRecord`/
 * `GenerationVersion` fields get set afterward (plain generation vs. a View's
 * `viewId`/`kind: 'view'`).
 */
async function submitGeneration(params: {
  context: AppContext;
  project: Project;
  renderCore: RunGenerationRequest['renderCore'];
  promptText: string;
  aspectRatio: string;
  resolution: string;
  sourceAsset: { ref: AssetRef; data: Uint8Array };
  referenceAssets: { ref: AssetRef; data: Uint8Array }[];
  /**
   * BUILD 21 (cost/duplicate-generation safety) — a client-supplied
   * `Idempotency-Key` header value, when present. Falls back to a fresh,
   * always-unique id, which preserves the exact prior behavior (a brand-new
   * job every call) for any caller that never sends the header.
   */
  clientIdempotencyKey?: string | undefined;
}): Promise<{ job: JobRecord; adapter: ImageGenerationAdapter; generationResult: GenerationResult; outputAssets: AssetRef[] }> {
  const { context, project, sourceAsset, referenceAssets } = params;
  const requestId = params.clientIdempotencyKey ?? randomUUID();
  const generationRequest = {
    requestId,
    promptText: params.promptText,
    sourceAssets: [{ data: sourceAsset.data, contentType: sourceAsset.ref.contentType }],
    referenceAssets: referenceAssets.map((a) => ({ data: a.data, contentType: a.ref.contentType })),
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
  };

  const adapter = context.imageGenerationService.resolve(RENDER_CORE_SELECTION[params.renderCore]);
  const validation = adapter.validate(generationRequest);
  if (!validation.valid) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid generation request for adapter "${adapter.id}": ${validation.errors.join('; ')}`,
      retryable: false,
    });
  }

  const job = await context.jobQueue.enqueue({ idempotencyKey: requestId });

  // BUILD 21 — this exact Idempotency-Key already ran a real provider call to
  // completion; replaying it would silently double-bill the provider (and
  // could hand the caller a second, different image for a request it
  // believes already succeeded once). Reuse the cached outcome instead of
  // calling the provider again. A `'failed'` prior attempt is deliberately
  // NOT short-circuited here — retrying a generation that never actually
  // succeeded is the caller's legitimate, expected recovery path, not a
  // duplicate-cost risk.
  if (job.status === 'succeeded' && job.result) {
    const cached = job.result as { generationResult: GenerationResult; outputAssets: AssetRef[] };
    return { job, adapter, generationResult: cached.generationResult, outputAssets: cached.outputAssets };
  }
  if (job.status === 'running') {
    throw new DomainError({
      code: 'GENERATION_IN_PROGRESS',
      message: 'A generation with this idempotency key is already in progress.',
      retryable: true,
    });
  }

  await context.jobQueue.updateStatus(job.id, 'running');

  let generationResult: GenerationResult;
  const startedAt = Date.now();
  try {
    generationResult = await adapter.generate(generationRequest);
  } catch (error) {
    await context.jobQueue.updateStatus(job.id, 'failed');
    // BUILD 21 Phase 15 (Observability) — one structured, secret-free log
    // line per failed attempt: requestId/provider/latency/failure category.
    // Never the request/response bytes, never a raw provider error body
    // (already sanitized upstream by each adapter's own classify function).
    context.logger.error('AI provider generation attempt failed', {
      requestId,
      provider: adapter.id,
      latencyMs: Date.now() - startedAt,
      code: error instanceof DomainError ? error.code : 'INTERNAL_ERROR',
      providerCode: error instanceof DomainError ? error.providerCode : undefined,
    });
    throw error;
  }
  context.logger.info('AI provider generation attempt completed', {
    requestId,
    provider: adapter.id,
    latencyMs: Date.now() - startedAt,
    outcome: generationResult.status,
    outputCount: generationResult.outputAssetUrls.length,
  });

  // BUILD 23 — a real bug fix: this block previously ran unguarded, so a
  // provider that returned invalid output (GENERATION_OUTPUT_INVALID) or a
  // real AssetStore write failure left the job stuck 'running' forever —
  // the provider had already been called (and potentially billed) but the
  // job record never reflected that the attempt was over. A stuck 'running'
  // job also permanently blocks this exact Idempotency-Key from ever
  // succeeding again (see the 'running' check above — it would keep
  // rejecting every retry as GENERATION_IN_PROGRESS). Any failure here now
  // marks the job 'failed' for real, same as a provider-call failure above.
  let outputAssets: AssetRef[];
  try {
    outputAssets = await Promise.all(
      generationResult.outputAssetUrls.map(async (uri) => {
        const decoded = validateImageOutput(decodeDataUri(uri));
        try {
          return await context.assetStore.put({ projectId: project.id, contentType: decoded.contentType, data: decoded.data });
        } catch (error) {
          throw new DomainError({
            code: 'ASSET_STORE_ERROR',
            message: `Failed to persist a real, valid generated image: ${error instanceof Error ? error.message : String(error)}`,
            retryable: true,
          });
        }
      }),
    );
  } catch (error) {
    await context.jobQueue.updateStatus(job.id, 'failed');
    context.logger.error('AI provider generation output validation/persistence failed', {
      requestId,
      provider: adapter.id,
      code: error instanceof DomainError ? error.code : 'INTERNAL_ERROR',
    });
    throw error;
  }

  const finalStatus = generationResult.status === 'succeeded' ? 'succeeded' : 'failed';
  await context.jobQueue.updateStatus(job.id, finalStatus, finalStatus === 'succeeded' ? { generationResult, outputAssets } : undefined);

  return { job, adapter, generationResult, outputAssets };
}

/**
 * BUILD 21 — reads an optional client-supplied `Idempotency-Key` request
 * header (standard practice for cost-bearing generation endpoints). Absent
 * for every existing caller/test, which keeps prior behavior (a fresh,
 * always-unique id per call) exactly unchanged.
 */
function readIdempotencyKey(req: IncomingMessage): string | undefined {
  const header = req.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * docs/11_IMAGE_GENERATION_SPEC.md steps 1-9 (steps 10-11, QC/regeneration,
 * are BUILD 17). Unlike analysis/reference extraction, this route does not
 * re-derive the compiled prompt server-side — `promptText` arrives already
 * compiled (BUILD 11's `compilePromptOutput`, pure/no-I/O, already ran
 * client-side) — this route's job is steps 2-3 (freeze the job/version),
 * 5-6 (adapt + submit to the real provider), and 7-9 (track status, store
 * outputs, store provenance).
 */
export async function handleRunGeneration(
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext,
  user: AuthenticatedUser,
  projectId: string,
): Promise<void> {
  const project = await resolveOwnedProjectOrThrow(context, projectId, user);

  const raw = await readBody(req, MAX_GENERATION_BODY_BYTES);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new DomainError({ code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.', retryable: false });
  }
  const result = runGenerationRequestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid generation request: ${result.error.issues.map((i) => i.message).join('; ')}`,
      retryable: false,
    });
  }

  const sourceAsset = await resolveAssetOrThrow(context, project, result.data.sourceAssetId, 'asset');
  const referenceAssets = await Promise.all(
    result.data.referenceAssetIds.map((assetId) => resolveAssetOrThrow(context, project, assetId, 'reference asset')),
  );

  const { job, adapter, generationResult, outputAssets } = await submitGeneration({
    context,
    project,
    renderCore: result.data.renderCore,
    promptText: result.data.promptText,
    aspectRatio: result.data.aspectRatio,
    resolution: result.data.resolution,
    sourceAsset,
    referenceAssets,
    clientIdempotencyKey: readIdempotencyKey(req),
  });

  const now = new Date().toISOString();
  const generationRecord: GenerationRecord = {
    id: randomUUID(),
    projectId: project.id,
    viewId: null,
    provider: adapter.id,
    model: typeof generationResult.usageMetadata['model'] === 'string' ? (generationResult.usageMetadata['model'] as string) : 'unknown',
    promptVersion: result.data.promptVersion,
    scenarioVersion: result.data.scenarioVersion,
    sourceAssets: [sourceAsset.ref.id],
    referenceAssets: referenceAssets.map((a) => a.ref.id),
    status: generationResult.status === 'succeeded' ? 'succeeded' : 'failed',
    outputAssets: outputAssets.map((a) => a.id),
    usageMetadata: generationResult.usageMetadata,
  };
  await context.generationRepository.create(generationRecord);

  const version: GenerationVersion = {
    id: randomUUID(),
    projectId: project.id,
    parentVersionId: project.currentVersionId || null,
    kind: 'generation',
    snapshotRef: generationRecord.id,
    createdAt: now as Timestamp,
    createdBy: user.id,
  };
  await context.versionRepository.create(version);

  const updatedProject = await context.projectRepository.update({
    ...project,
    currentVersionId: version.id,
    updatedAt: now as Timestamp,
  });

  sendJson(res, 201, {
    jobId: job.id,
    generationId: generationRecord.id,
    versionId: version.id,
    project: updatedProject,
    generation: generationRecord,
    outputAssetUrls: outputAssets.map((a) => buildAssetUrl(context.assetUrlSigner, a.id)),
  });
}

/**
 * docs/11 steps 10-11 / docs/15_AI_QC_SPEC.md (BUILD 17) — VERIFY stage.
 * Compares the generation's output against its source asset and the
 * "expected structured intent" (docs/03 §4 step 5). `structuredIntelligence`/
 * `projectDNA` are never re-sent by the client for this — `analysisId` looks
 * up the already-persisted, already-validated `AnalysisRecord` (BUILD 07) and
 * `deriveProjectDNA()` (BUILD 08, pure) re-derives Project DNA from it,
 * avoiding a second transmission/re-validation of the same 12-layer data.
 */
export async function handleRunQc(
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext,
  user: AuthenticatedUser,
  projectId: string,
  generationId: string,
): Promise<void> {
  const project = await resolveOwnedProjectOrThrow(context, projectId, user);

  const generation = await context.generationRepository.getById(generationId);
  if (!generation || generation.projectId !== project.id) {
    throw new DomainError({
      code: 'GENERATION_NOT_FOUND',
      message: `No generation with id ${generationId} on project ${projectId}`,
      retryable: false,
    });
  }

  const raw = await readBody(req, MAX_GENERATION_BODY_BYTES);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new DomainError({ code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.', retryable: false });
  }
  const result = runQcRequestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid QC request: ${result.error.issues.map((i) => i.message).join('; ')}`,
      retryable: false,
    });
  }

  const analysisRecord = await context.analysisRepository.getById(result.data.analysisId);
  if (!analysisRecord || analysisRecord.projectId !== project.id) {
    throw new DomainError({
      code: 'ANALYSIS_NOT_FOUND',
      message: `No analysis with id ${result.data.analysisId} on project ${projectId}`,
      retryable: false,
    });
  }
  const structuredIntelligence = analysisRecord.structuredIntelligence as StructuredIntelligence;

  const sourceAssetId = generation.sourceAssets[0];
  if (!sourceAssetId) {
    throw new DomainError({
      code: 'ASSET_NOT_FOUND',
      message: `Generation ${generationId} has no source asset recorded.`,
      retryable: false,
    });
  }
  const sourceAsset = await resolveAssetOrThrow(context, project, sourceAssetId, 'source asset');

  const outputAssetId = result.data.outputAssetId ?? generation.outputAssets[0];
  if (!outputAssetId) {
    throw new DomainError({
      code: 'ASSET_NOT_FOUND',
      message: `Generation ${generationId} has no output asset to evaluate.`,
      retryable: false,
    });
  }
  const outputAsset = await resolveAssetOrThrow(context, project, outputAssetId, 'output asset');

  const enabledLocks = result.data.locks.filter((lock) => lock.enabled).map((lock) => lock.id);
  const qc = await context.aiQcEngine.evaluate({
    sourceAsset: { data: sourceAsset.data, contentType: sourceAsset.ref.contentType },
    outputAsset: { data: outputAsset.data, contentType: outputAsset.ref.contentType },
    normalizedRequest: {
      structuredIntelligence,
      projectDNA: deriveProjectDNA(structuredIntelligence),
      enabledLocks,
      resolvedStyle: result.data.resolvedStyle ?? structuredIntelligence.layers.style.data.style,
      instructions: result.data.instructions,
    },
  });

  sendJson(res, 200, { generationId, qc });
}

/**
 * docs/03 §4 step 5 VERIFY→CREATE loop / docs/15 "regeneration ... preserves
 * all valid prior constraints" (BUILD 17). Reuses `submitGeneration` — the
 * exact same CREATE-stage helper `/generations` already uses — since the
 * correction itself was already folded into the client's re-resolved
 * Reasoning Engine `instructions` and recompiled prompt (the same "client
 * owns Reasoning Engine + Prompt Compiler" pattern as every other render,
 * BUILD 08/11's `conflicts`-preserving resolution already does this for
 * real). This route's own job is only submitting it again and recording
 * *why*, for provenance (CLAUDE.md rule 14): `correctionInstruction` and
 * which failed generation this regenerates.
 */
export async function handleRegenerate(
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext,
  user: AuthenticatedUser,
  projectId: string,
  generationId: string,
): Promise<void> {
  const project = await resolveOwnedProjectOrThrow(context, projectId, user);

  const failedGeneration = await context.generationRepository.getById(generationId);
  if (!failedGeneration || failedGeneration.projectId !== project.id) {
    throw new DomainError({
      code: 'GENERATION_NOT_FOUND',
      message: `No generation with id ${generationId} on project ${projectId}`,
      retryable: false,
    });
  }

  const raw = await readBody(req, MAX_GENERATION_BODY_BYTES);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new DomainError({ code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.', retryable: false });
  }
  const result = runRegenerateRequestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid regenerate request: ${result.error.issues.map((i) => i.message).join('; ')}`,
      retryable: false,
    });
  }

  const sourceAsset = await resolveAssetOrThrow(context, project, result.data.sourceAssetId, 'asset');
  const referenceAssets = await Promise.all(
    result.data.referenceAssetIds.map((assetId) => resolveAssetOrThrow(context, project, assetId, 'reference asset')),
  );

  const { job, adapter, generationResult, outputAssets } = await submitGeneration({
    context,
    project,
    renderCore: result.data.renderCore,
    promptText: result.data.promptText,
    aspectRatio: result.data.aspectRatio,
    resolution: result.data.resolution,
    sourceAsset,
    referenceAssets,
    clientIdempotencyKey: readIdempotencyKey(req),
  });

  const now = new Date().toISOString();
  const generationRecord: GenerationRecord = {
    id: randomUUID(),
    projectId: project.id,
    viewId: null,
    provider: adapter.id,
    model:
      typeof generationResult.usageMetadata['model'] === 'string' ? (generationResult.usageMetadata['model'] as string) : 'unknown',
    promptVersion: result.data.promptVersion,
    scenarioVersion: result.data.scenarioVersion,
    sourceAssets: [sourceAsset.ref.id],
    referenceAssets: referenceAssets.map((a) => a.ref.id),
    status: generationResult.status === 'succeeded' ? 'succeeded' : 'failed',
    outputAssets: outputAssets.map((a) => a.id),
    usageMetadata: {
      ...generationResult.usageMetadata,
      regeneratedFromGenerationId: failedGeneration.id,
      correctionInstruction: result.data.correctionInstruction,
    },
  };
  await context.generationRepository.create(generationRecord);

  const version: GenerationVersion = {
    id: randomUUID(),
    projectId: project.id,
    parentVersionId: project.currentVersionId || null,
    kind: 'generation',
    snapshotRef: generationRecord.id,
    createdAt: now as Timestamp,
    createdBy: user.id,
  };
  await context.versionRepository.create(version);

  const updatedProject = await context.projectRepository.update({
    ...project,
    currentVersionId: version.id,
    updatedAt: now as Timestamp,
  });

  await context.auditLogRepository.record({
    id: randomUUID(),
    action: 'generation.regenerate',
    actorId: user.id,
    projectId: project.id,
    targetId: generationRecord.id,
    metadata: { regeneratedFromGenerationId: failedGeneration.id, correctionInstruction: result.data.correctionInstruction },
    createdAt: now,
  });

  sendJson(res, 201, {
    jobId: job.id,
    generationId: generationRecord.id,
    versionId: version.id,
    project: updatedProject,
    generation: generationRecord,
    outputAssetUrls: outputAssets.map((a) => buildAssetUrl(context.assetUrlSigner, a.id)),
  });
}

/**
 * docs/13_MULTIVIEW_SPEC.md (BUILD 15). Like `/generations`, does not
 * re-resolve `resolveView()`/re-compile the prompt server-side — both are
 * pure/no-I/O (`packages/ai-core/src/view.ts`, BUILD 11's compiler) and
 * already ran client-side; the client submits the already-compiled prompt
 * plus the real proposal fields for provenance. Real output/provenance
 * fields the amendment requires: a `ViewRecord` capturing what was proposed
 * and what a Sync View structurally ignored, `GenerationRecord.viewId` (
 * scaffolded since BUILD 02, populated for the first time here), and a
 * `kind: 'view'` `GenerationVersion` — "every view/generation is linked to
 * its parent version and project snapshot."
 */
export async function handleRunView(
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext,
  user: AuthenticatedUser,
  projectId: string,
): Promise<void> {
  const project = await resolveOwnedProjectOrThrow(context, projectId, user);

  const raw = await readBody(req, MAX_GENERATION_BODY_BYTES);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new DomainError({ code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.', retryable: false });
  }
  const result = runViewRequestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid view request: ${result.error.issues.map((i) => i.message).join('; ')}`,
      retryable: false,
    });
  }

  const sourceAsset = await resolveAssetOrThrow(context, project, result.data.sourceAssetId, 'asset');
  const referenceAssets = await Promise.all(
    result.data.referenceAssetIds.map((assetId) => resolveAssetOrThrow(context, project, assetId, 'reference asset')),
  );

  const { job, adapter, generationResult, outputAssets } = await submitGeneration({
    context,
    project,
    renderCore: result.data.renderCore,
    promptText: result.data.promptText,
    aspectRatio: result.data.aspectRatio,
    resolution: result.data.resolution,
    sourceAsset,
    referenceAssets,
    clientIdempotencyKey: readIdempotencyKey(req),
  });

  const now = new Date().toISOString();
  const generationId = randomUUID();
  const viewRecord: ViewRecord = {
    id: randomUUID(),
    projectId: project.id,
    mode: result.data.mode,
    cameraProposal: omitUndefinedKeys(result.data.cameraProposal),
    materialProposal: result.data.materialProposal ?? null,
    lightingProposal: omitUndefinedKeys(result.data.lightingProposal),
    styleProposal: result.data.styleProposal ?? null,
    ignoredProposals: result.data.ignoredProposals,
    parentVersionId: project.currentVersionId || null,
    resultingGenerationId: generationId,
    createdAt: now,
  };
  await context.viewRepository.create(viewRecord);

  const generationRecord: GenerationRecord = {
    id: generationId,
    projectId: project.id,
    viewId: viewRecord.id,
    provider: adapter.id,
    model: typeof generationResult.usageMetadata['model'] === 'string' ? (generationResult.usageMetadata['model'] as string) : 'unknown',
    promptVersion: result.data.promptVersion,
    scenarioVersion: result.data.scenarioVersion,
    sourceAssets: [sourceAsset.ref.id],
    referenceAssets: referenceAssets.map((a) => a.ref.id),
    status: generationResult.status === 'succeeded' ? 'succeeded' : 'failed',
    outputAssets: outputAssets.map((a) => a.id),
    usageMetadata: generationResult.usageMetadata,
  };
  await context.generationRepository.create(generationRecord);

  const version: GenerationVersion = {
    id: randomUUID(),
    projectId: project.id,
    parentVersionId: project.currentVersionId || null,
    kind: 'view',
    snapshotRef: generationRecord.id,
    createdAt: now as Timestamp,
    createdBy: user.id,
  };
  await context.versionRepository.create(version);

  const updatedProject = await context.projectRepository.update({
    ...project,
    currentVersionId: version.id,
    updatedAt: now as Timestamp,
  });

  sendJson(res, 201, {
    jobId: job.id,
    viewId: viewRecord.id,
    generationId: generationRecord.id,
    versionId: version.id,
    project: updatedProject,
    view: viewRecord,
    generation: generationRecord,
    outputAssetUrls: outputAssets.map((a) => buildAssetUrl(context.assetUrlSigner, a.id)),
  });
}

function composeEditInstruction(params: {
  intendedChange: string;
  targetRegionDescription: string;
  protectedLocks: string[];
}): string {
  const parts = [`Target region: ${params.targetRegionDescription}.`, `Change: ${params.intendedChange}.`];
  if (params.protectedLocks.length > 0) {
    parts.push(`Do not alter: ${params.protectedLocks.join(', ')} (locked, must be preserved exactly).`);
  }
  return parts.join(' ');
}

/**
 * docs/12_EDITOR_SPEC.md Advanced Editor (BUILD 14) — edits an EXISTING
 * generation's output, never the original viewport source. Reuses the same
 * provider the parent generation used (`generation.provider`), since a
 * mid-stream provider switch would silently change the model's understanding
 * of the image being edited. Each of docs/12's five required declarations
 * maps directly onto the `EditRecord` this creates — see repositories.ts.
 */
export async function handleRunEdit(
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext,
  user: AuthenticatedUser,
  projectId: string,
  generationId: string,
): Promise<void> {
  const project = await resolveOwnedProjectOrThrow(context, projectId, user);

  const parentGeneration = await context.generationRepository.getById(generationId);
  if (!parentGeneration || parentGeneration.projectId !== project.id) {
    throw new DomainError({
      code: 'GENERATION_NOT_FOUND',
      message: `No generation with id ${generationId} on project ${projectId}`,
      retryable: false,
    });
  }

  const raw = await readBody(req, MAX_GENERATION_BODY_BYTES);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new DomainError({ code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.', retryable: false });
  }
  const result = runEditRequestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid edit request: ${result.error.issues.map((i) => i.message).join('; ')}`,
      retryable: false,
    });
  }

  const sourceAsset = await context.assetStore.get(result.data.sourceAssetId as AssetId);
  if (!sourceAsset || sourceAsset.ref.projectId !== project.id) {
    throw new DomainError({
      code: 'ASSET_NOT_FOUND',
      message: `No asset with id ${result.data.sourceAssetId} on project ${projectId}`,
      retryable: false,
    });
  }
  let maskAsset: Awaited<ReturnType<typeof context.assetStore.get>> = null;
  if (result.data.maskAssetId) {
    maskAsset = await context.assetStore.get(result.data.maskAssetId as AssetId);
    if (!maskAsset || maskAsset.ref.projectId !== project.id) {
      throw new DomainError({
        code: 'ASSET_NOT_FOUND',
        message: `No mask asset with id ${result.data.maskAssetId} on project ${projectId}`,
        retryable: false,
      });
    }
  }

  const adapter = context.imageGenerationService.resolve(parentGeneration.provider as RenderCoreSelection);
  if (!adapter.edit) {
    throw new DomainError({
      code: 'EDIT_NOT_SUPPORTED',
      message: `Adapter "${adapter.id}" does not support editing (capabilities().supportsEdit is false or edit() is unimplemented).`,
      retryable: false,
    });
  }

  const requestId = randomUUID();
  const editRequest = {
    requestId,
    promptText: composeEditInstruction({
      intendedChange: result.data.intendedChange,
      targetRegionDescription: result.data.targetRegionDescription,
      protectedLocks: result.data.protectedLocks,
    }),
    sourceAsset: { data: sourceAsset.data, contentType: sourceAsset.ref.contentType },
    ...(maskAsset ? { maskAsset: { data: maskAsset.data, contentType: maskAsset.ref.contentType } } : {}),
    aspectRatio: result.data.aspectRatio,
    resolution: result.data.resolution,
  };

  const job = await context.jobQueue.enqueue({ idempotencyKey: requestId });
  await context.jobQueue.updateStatus(job.id, 'running');

  let editResult;
  try {
    editResult = await adapter.edit(editRequest);
  } catch (error) {
    await context.jobQueue.updateStatus(job.id, 'failed');
    throw error;
  }

  const outputAssets = await Promise.all(
    editResult.outputAssetUrls.map(async (uri) => {
      const decoded = validateImageOutput(decodeDataUri(uri));
      return context.assetStore.put({ projectId: project.id, contentType: decoded.contentType, data: decoded.data });
    }),
  );

  const now = new Date().toISOString();
  const editRecord: EditRecord = {
    id: randomUUID(),
    projectId: project.id,
    parentGenerationId: parentGeneration.id,
    sourceAssetId: sourceAsset.ref.id,
    targetRegionDescription: result.data.targetRegionDescription,
    maskAssetId: maskAsset ? maskAsset.ref.id : null,
    intendedChange: result.data.intendedChange,
    category: result.data.category,
    protectedLocks: result.data.protectedLocks,
    resultingAssetId: outputAssets[0]?.id ?? null,
    status: editResult.status === 'succeeded' ? 'succeeded' : 'failed',
    usageMetadata: editResult.usageMetadata,
    createdAt: now,
  };
  await context.editRepository.create(editRecord);

  const version: GenerationVersion = {
    id: randomUUID(),
    projectId: project.id,
    parentVersionId: project.currentVersionId || null,
    kind: 'edit',
    snapshotRef: editRecord.id,
    createdAt: now as Timestamp,
    createdBy: user.id,
  };
  await context.versionRepository.create(version);

  const updatedProject = await context.projectRepository.update({
    ...project,
    currentVersionId: version.id,
    updatedAt: now as Timestamp,
  });

  await context.jobQueue.updateStatus(job.id, editResult.status === 'succeeded' ? 'succeeded' : 'failed');

  sendJson(res, 201, {
    jobId: job.id,
    editId: editRecord.id,
    versionId: version.id,
    project: updatedProject,
    edit: editRecord,
    outputAssetUrls: outputAssets.map((a) => buildAssetUrl(context.assetUrlSigner, a.id)),
  });
}

const VIDEO_RENDER_CORE_SELECTION: Record<RunVideoRequest['renderCore'], VideoRenderCoreSelection> = {
  Veo: 'veo',
  Sora: 'sora',
  Auto: 'auto',
};

/**
 * docs/14_VIDEO_SPEC.md "Input: final image + Project DNA + motion plan"
 * (BUILD 16). Unlike `/generations`/`/edits`/`/views`, Veo's real API is
 * genuinely asynchronous (docs/11 "long-running operations must be
 * asynchronous") — this route only submits the job and records it as
 * `running`; `handleGetVideoStatus` below is what actually observes
 * completion. `protectedLocks` is always the full `VIDEO_LOCK_IDS` set
 * (video-vocabulary.ts) — docs/14 names these as fixed guarantees, not a
 * per-request user choice, unlike the 5 image Locks.
 */
export async function handleRunVideo(
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext,
  user: AuthenticatedUser,
  projectId: string,
  generationId: string,
): Promise<void> {
  const project = await resolveOwnedProjectOrThrow(context, projectId, user);

  const parentGeneration = await context.generationRepository.getById(generationId);
  if (!parentGeneration || parentGeneration.projectId !== project.id) {
    throw new DomainError({
      code: 'GENERATION_NOT_FOUND',
      message: `No generation with id ${generationId} on project ${projectId}`,
      retryable: false,
    });
  }

  const raw = await readBody(req, MAX_GENERATION_BODY_BYTES);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new DomainError({ code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.', retryable: false });
  }
  const result = runVideoRequestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid video request: ${result.error.issues.map((i) => i.message).join('; ')}`,
      retryable: false,
    });
  }

  const sourceAsset = await resolveAssetOrThrow(context, project, result.data.sourceAssetId, 'asset');

  const adapter = context.videoGenerationService.resolve(VIDEO_RENDER_CORE_SELECTION[result.data.renderCore]);
  const requestId = randomUUID();
  const videoRequest = {
    requestId,
    promptText: result.data.promptText,
    sourceImage: { data: sourceAsset.data, contentType: sourceAsset.ref.contentType },
    aspectRatio: result.data.aspectRatio,
    resolution: result.data.resolution,
    durationSeconds: result.data.durationSeconds,
  };

  const validation = adapter.validate(videoRequest);
  if (!validation.valid) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid video request for adapter "${adapter.id}": ${validation.errors.join('; ')}`,
      retryable: false,
    });
  }

  const submission = await adapter.submit(videoRequest);

  const now = new Date().toISOString();
  const videoRecord: VideoRecord = {
    id: randomUUID(),
    projectId: project.id,
    parentGenerationId: parentGeneration.id,
    sourceAssetId: sourceAsset.ref.id,
    motionType: result.data.motionType,
    motionDescription: result.data.motionDescription,
    durationSeconds: result.data.durationSeconds,
    protectedLocks: [...VIDEO_LOCK_IDS],
    provider: adapter.id,
    providerOperationName: submission.operation.operationName,
    status: 'running',
    resultingAssetId: null,
    usageMetadata: {},
    createdAt: now,
    updatedAt: now,
  };
  await context.videoRepository.create(videoRecord);

  const version: GenerationVersion = {
    id: randomUUID(),
    projectId: project.id,
    parentVersionId: project.currentVersionId || null,
    kind: 'video',
    snapshotRef: videoRecord.id,
    createdAt: now as Timestamp,
    createdBy: user.id,
  };
  await context.versionRepository.create(version);

  const updatedProject = await context.projectRepository.update({
    ...project,
    currentVersionId: version.id,
    updatedAt: now as Timestamp,
  });

  sendJson(res, 202, {
    videoId: videoRecord.id,
    versionId: version.id,
    project: updatedProject,
    video: videoRecord,
  });
}

/**
 * docs/11 "long-running operations must be asynchronous" — the client polls
 * this route (BUILD 16 is the first gate needing a real poll endpoint) until
 * `video.status` leaves `running`. A video already `succeeded`/`failed` is
 * returned as-is without re-polling the provider or re-downloading the
 * output — the terminal state was already stored.
 */
export async function handleGetVideoStatus(
  res: ServerResponse,
  context: AppContext,
  user: AuthenticatedUser,
  projectId: string,
  videoId: string,
): Promise<void> {
  const project = await resolveOwnedProjectOrThrow(context, projectId, user);

  const video = await context.videoRepository.getById(videoId);
  if (!video || video.projectId !== project.id) {
    throw new DomainError({ code: 'VIDEO_NOT_FOUND', message: `No video with id ${videoId} on project ${projectId}`, retryable: false });
  }

  if (video.status !== 'running' || !video.providerOperationName) {
    sendJson(res, 200, {
      video,
      outputAssetUrl: video.resultingAssetId ? buildAssetUrl(context.assetUrlSigner, video.resultingAssetId) : null,
    });
    return;
  }

  const adapter = context.videoGenerationService.resolve(video.provider as VideoRenderCoreSelection);
  const pollResult = await adapter.pollStatus({ operationName: video.providerOperationName });

  if (pollResult.status === 'running') {
    sendJson(res, 200, { video, outputAssetUrl: null });
    return;
  }

  const now = new Date().toISOString();

  if (pollResult.status === 'failed') {
    const updated = await context.videoRepository.update({
      ...video,
      status: 'failed',
      usageMetadata: pollResult.usageMetadata,
      updatedAt: now,
    });
    sendJson(res, 200, { video: updated, outputAssetUrl: null });
    return;
  }

  if (!pollResult.outputVideoUrl) {
    throw new DomainError({
      code: 'GENERATION_OUTPUT_INVALID',
      message: 'Video adapter reported success with no output video.',
      retryable: false,
    });
  }
  const decoded = decodeDataUri(pollResult.outputVideoUrl);
  const outputAsset = await context.assetStore.put({ projectId: project.id, contentType: decoded.contentType, data: decoded.data });

  const updated = await context.videoRepository.update({
    ...video,
    status: 'succeeded',
    resultingAssetId: outputAsset.id,
    usageMetadata: pollResult.usageMetadata,
    updatedAt: now,
  });

  sendJson(res, 200, { video: updated, outputAssetUrl: buildAssetUrl(context.assetUrlSigner, outputAsset.id) });
}

/**
 * docs/03 §9 "signed, time-limited URLs... no public bucket by default" +
 * "Audit log ... for asset access grants" (BUILD 18). Signature/expiry
 * verification only runs when `context.assetUrlSigner` is configured — same
 * graceful-degradation as every optional secret in this codebase (unset,
 * this stays exactly the plain unauthenticated fetch it always was).
 */
export async function handleGetAsset(
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext,
  user: AuthenticatedUser,
  assetId: string,
): Promise<void> {
  const found = await context.assetStore.get(assetId as AssetId);
  if (!found) {
    throw new DomainError({ code: 'ASSET_NOT_FOUND', message: `No asset with id ${assetId}`, retryable: false });
  }

  // RELEASE 02 — real ownership check, not just a signature: an asset has
  // no `:projectId` in its own URL, so ownership is resolved via the asset's
  // own recorded `projectId` — never a client-supplied id (docs/16 IDOR).
  const owningProject = await context.projectRepository.getById(found.ref.projectId);
  if (!owningProject || owningProject.ownerId !== user.id) {
    throw new DomainError({ code: 'ASSET_NOT_FOUND', message: `No asset with id ${assetId}`, retryable: false });
  }

  if (context.assetUrlSigner) {
    const requestUrl = new URL(req.url ?? '', 'http://internal');
    const expiresAt = Number(requestUrl.searchParams.get('exp'));
    const signature = requestUrl.searchParams.get('sig') ?? '';
    if (!context.assetUrlSigner.verify(assetId, expiresAt, signature)) {
      throw new DomainError({
        code: 'INVALID_ASSET_SIGNATURE',
        message: 'Asset URL signature is missing, invalid, or expired.',
        retryable: false,
      });
    }
  }

  await context.auditLogRepository.record({
    id: randomUUID(),
    action: 'asset.access',
    actorId: user.id,
    projectId: found.ref.projectId,
    targetId: assetId,
    metadata: {},
    createdAt: new Date().toISOString(),
  });

  res.writeHead(200, { 'content-type': found.ref.contentType, 'content-length': found.data.byteLength });
  res.end(Buffer.from(found.data));
}

/**
 * docs/16_SECURITY_SPEC.md "Define retention/deletion policy for user
 * assets" (BUILD 18) — `AssetStore.scheduleDeletion()` existed since BUILD
 * 02 but no route ever called it. Real, on-demand deletion; the exact
 * *automatic* retention timeframe (delete after N days unused, etc.) stays
 * the documented product/legal decision docs/03 §13 already flags it as —
 * this makes the interface point actually reachable, not more than that.
 */
export async function handleDeleteAsset(
  res: ServerResponse,
  context: AppContext,
  user: AuthenticatedUser,
  projectId: string,
  assetId: string,
): Promise<void> {
  const project = await resolveOwnedProjectOrThrow(context, projectId, user);

  const found = await context.assetStore.get(assetId as AssetId);
  if (!found || found.ref.projectId !== project.id) {
    throw new DomainError({ code: 'ASSET_NOT_FOUND', message: `No asset with id ${assetId} on project ${projectId}`, retryable: false });
  }

  await context.assetStore.scheduleDeletion(assetId as AssetId);

  await context.auditLogRepository.record({
    id: randomUUID(),
    action: 'asset.delete',
    actorId: user.id,
    projectId: project.id,
    targetId: assetId,
    metadata: {},
    createdAt: new Date().toISOString(),
  });

  res.writeHead(204);
  res.end();
}
