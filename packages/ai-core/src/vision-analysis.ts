import type { ProjectModule } from '@avs/project-core';
import type { StructuredIntelligenceLayers } from './structured-intelligence-schema.js';

/**
 * Vision Analysis Engine contract — docs/05_AI_ANALYSIS_SPEC.md (12 layers).
 * BUILD 07 implements this for real (gemini-vision-engine.ts); this file
 * keeps only the stable contract types.
 */
export interface StructuredIntelligence {
  analysisVersion: string;
  module: ProjectModule;
  layers: StructuredIntelligenceLayers;
}

/**
 * The engine analyzes real bytes it's handed, not a URL it fetches itself —
 * the caller (apps/api) already has the bytes from AssetStore.get(), and an
 * engine that fetches an arbitrary caller-supplied URL is an SSRF-shaped
 * design. contentType lets the engine build a correct multimodal request
 * without re-sniffing the format.
 */
export interface SourceAssetRef {
  assetId: string;
  data: Uint8Array;
  contentType: string;
}

export interface VisionAnalysisEngine {
  analyze(sourceAsset: SourceAssetRef, module: ProjectModule): Promise<StructuredIntelligence>;
}

/** Alias matching BUILD 02 service-boundary naming; same contract as VisionAnalysisEngine. */
export type VisionAnalysisService = VisionAnalysisEngine;
