import type {
  AnalysisRepository,
  AssetStore,
  EditRepository,
  GenerationRepository,
  ProjectRepository,
  ReferenceRepository,
  VersionRepository,
  ViewRepository,
  VideoRepository,
} from '@avs/project-core';
import {
  InMemoryAnalysisRepository,
  InMemoryAssetStore,
  InMemoryEditRepository,
  InMemoryGenerationRepository,
  InMemoryProjectRepository,
  InMemoryReferenceRepository,
  InMemoryVersionRepository,
  InMemoryViewRepository,
  InMemoryVideoRepository,
} from '@avs/storage-adapters';
import type { ReferenceIntelligence, VisionAnalysisEngine } from '@avs/ai-core';
import { createGeminiReferenceIntelligenceEngine, createGeminiVisionAnalysisEngine } from '@avs/ai-core';
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

/**
 * Repository/engine instances the API routes depend on — docs/03 ADR-003.
 * Routes never construct a concrete repository or provider adapter
 * themselves; they receive one through this context, so swapping the
 * in-memory implementation for a real database/blob store (docs/03 §13) or
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
}

/**
 * In-memory reference implementations — dev/test only (see storage-adapters).
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
  } = {},
): AppContext {
  return {
    projectRepository: new InMemoryProjectRepository(),
    assetStore: new InMemoryAssetStore(),
    analysisRepository: new InMemoryAnalysisRepository(),
    versionRepository: new InMemoryVersionRepository(),
    visionAnalysisEngine: createGeminiVisionAnalysisEngine({ apiKey: config.geminiApiKey }),
    referenceRepository: new InMemoryReferenceRepository(),
    referenceIntelligenceEngine: createGeminiReferenceIntelligenceEngine({ apiKey: config.geminiApiKey }),
    generationRepository: new InMemoryGenerationRepository(),
    imageGenerationService: new ImageGenerationService({
      'nano-banana': createNanoBananaAdapter({ apiKey: config.nanoBananaApiKey }),
      'chatgpt-image': createChatGPTImageAdapter({ apiKey: config.chatgptImageApiKey }),
      'google-flow': new GoogleFlowAdapter(),
    }),
    jobQueue: new InMemoryJobQueue(),
    editRepository: new InMemoryEditRepository(),
    viewRepository: new InMemoryViewRepository(),
    videoRepository: new InMemoryVideoRepository(),
    videoGenerationService: new VideoGenerationService({
      veo: createVeoAdapter({ apiKey: config.veoApiKey }),
      sora: new SoraAdapter(),
    }),
  };
}
