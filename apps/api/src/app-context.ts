import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AnalysisRepository,
  AssetStore,
  AuditLogRepository,
  EditRepository,
  GenerationRepository,
  ProjectRepository,
  ReferenceRepository,
  VersionRepository,
  ViewRepository,
  VideoRepository,
} from '@avs/project-core';
import {
  LocalDiskAssetStore,
  SqliteAnalysisRepository,
  SqliteAuditLogRepository,
  SqliteDatabase,
  SqliteEditRepository,
  SqliteGenerationRepository,
  SqliteProjectRepository,
  SqliteReferenceRepository,
  SqliteVersionRepository,
  SqliteVideoRepository,
  SqliteViewRepository,
} from '@avs/storage-adapters';
import type { AiQc, ReferenceIntelligence, VisionAnalysisEngine } from '@avs/ai-core';
import { createGeminiQcEngine, createGeminiReferenceIntelligenceEngine, createGeminiVisionAnalysisEngine } from '@avs/ai-core';
import type { RateLimiter } from '@avs/shared';
import { createInMemoryRateLimiter } from '@avs/shared';
import {
  createChatGPTImageAdapter,
  createNanoBananaAdapter,
  GoogleFlowAdapter,
  ImageGenerationService,
  createVeoAdapter,
  SoraAdapter,
  VideoGenerationService,
} from '@avs/model-adapters';
import { InMemoryJobQueue, type JobQueue } from './job-queue.js';
import { createAssetUrlSigner, type AssetUrlSigner } from './signed-asset-url.js';

/** docs/16 "Rate limit expensive AI endpoints" — applied to analysis/reference/generation/edit/view/video/QC/regenerate routes (server.ts). */
export const AI_ROUTE_RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 };

/**
 * Repository/engine instances the API routes depend on — docs/03 ADR-003.
 * Routes never construct a concrete repository or provider adapter
 * themselves; they receive one through this context, so swapping the
 * storage engine (docs/03 §13 — still open behind these same interfaces) or
 * reconfiguring a provider touches only this file.
 */
export interface AppContext {
  projectRepository: ProjectRepository;
  assetStore: AssetStore;
  analysisRepository: AnalysisRepository;
  versionRepository: VersionRepository;
  visionAnalysisEngine: VisionAnalysisEngine;
  referenceRepository: ReferenceRepository;
  referenceIntelligenceEngine: ReferenceIntelligence;
  generationRepository: GenerationRepository;
  imageGenerationService: ImageGenerationService;
  jobQueue: JobQueue;
  editRepository: EditRepository;
  viewRepository: ViewRepository;
  videoRepository: VideoRepository;
  videoGenerationService: VideoGenerationService;
  aiQcEngine: AiQc;
  auditLogRepository: AuditLogRepository;
  assetUrlSigner: AssetUrlSigner | null;
  rateLimiter: RateLimiter;
}

/**
 * BUILD 18: repositories are real, `node:sqlite`-backed and disk-backed
 * (see @avs/storage-adapters) — no longer the in-memory placeholders every
 * prior gate flagged as "dev/test only, not a production datastore."
 * `dbPath`/`assetsDir` default to `:memory:`/a fresh temp directory so every
 * existing test (and any ad hoc `createAppContext()` call) keeps its exact
 * prior ephemeral-per-context semantics with zero call-site changes — real
 * persistence is opt-in via `server.ts`'s real startup path, which passes
 * `DATABASE_URL`/`ASSET_STORE_URL` from the environment.
 *
 * Each provider key is optional: without it, that provider's `generate()`
 * throws PROVIDER_NOT_CONFIGURED rather than the server failing to start.
 * Adapters are registered `nano-banana` first so `RenderCoreSelection: 'auto'`
 * (ImageGenerationService.resolve, "picks by capability + policy" per docs/03
 * §7) resolves to a real, working adapter rather than the still-NOT_IMPLEMENTED
 * `google-flow` (BUILD 12 finding — no official public API exists for it).
 */
export function createAppContext(
  config: {
    geminiApiKey?: string | undefined;
    nanoBananaApiKey?: string | undefined;
    chatgptImageApiKey?: string | undefined;
    veoApiKey?: string | undefined;
    dbPath?: string | undefined;
    assetsDir?: string | undefined;
    assetUrlSigningSecret?: string | undefined;
  } = {},
): AppContext {
  const db = new SqliteDatabase(config.dbPath ?? ':memory:');
  const assetsDir = config.assetsDir ?? mkdtempSync(join(tmpdir(), 'avs-assets-'));

  return {
    projectRepository: new SqliteProjectRepository(db),
    assetStore: new LocalDiskAssetStore(assetsDir),
    analysisRepository: new SqliteAnalysisRepository(db),
    versionRepository: new SqliteVersionRepository(db),
    visionAnalysisEngine: createGeminiVisionAnalysisEngine({ apiKey: config.geminiApiKey }),
    referenceRepository: new SqliteReferenceRepository(db),
    referenceIntelligenceEngine: createGeminiReferenceIntelligenceEngine({ apiKey: config.geminiApiKey }),
    generationRepository: new SqliteGenerationRepository(db),
    imageGenerationService: new ImageGenerationService({
      'nano-banana': createNanoBananaAdapter({ apiKey: config.nanoBananaApiKey }),
      'chatgpt-image': createChatGPTImageAdapter({ apiKey: config.chatgptImageApiKey }),
      'google-flow': new GoogleFlowAdapter(),
    }),
    jobQueue: new InMemoryJobQueue(),
    editRepository: new SqliteEditRepository(db),
    viewRepository: new SqliteViewRepository(db),
    videoRepository: new SqliteVideoRepository(db),
    videoGenerationService: new VideoGenerationService({
      veo: createVeoAdapter({ apiKey: config.veoApiKey }),
      sora: new SoraAdapter(),
    }),
    aiQcEngine: createGeminiQcEngine({ apiKey: config.geminiApiKey }),
    auditLogRepository: new SqliteAuditLogRepository(db),
    assetUrlSigner: createAssetUrlSigner(config.assetUrlSigningSecret),
    rateLimiter: createInMemoryRateLimiter(AI_ROUTE_RATE_LIMIT),
  };
}
