import type { GenerationAssetRef } from './types.js';

/**
 * Image → Video contract — docs/14_VIDEO_SPEC.md, docs/11 "Long-running
 * operations must be asynchronous." Genuinely different shape from
 * `ImageGenerationAdapter` (BUILD 12/13/14): real video providers (Veo) are
 * asynchronous operations — submit, then poll — not a single request/response
 * call, so this is `submit()` + `pollStatus()`, not `generate()`.
 */
export interface VideoAdapterCapabilities {
  maxDurationSeconds: number;
  supportedAspectRatios: string[];
  supportedResolutions: string[];
}

export interface VideoGenerationRequest {
  requestId: string;
  /** Includes the motion plan description (docs/14 "Input: final image + Project DNA + motion plan"). */
  promptText: string;
  sourceImage: GenerationAssetRef;
  aspectRatio: string;
  resolution: string;
  durationSeconds: number;
}

/** Opaque provider handle for a submitted, still-running operation — never assumed to be a URL an adapter fetches itself. */
export interface VideoOperationRef {
  operationName: string;
}

export interface VideoSubmission {
  operation: VideoOperationRef;
}

export type VideoJobStatus = 'running' | 'succeeded' | 'failed';

export interface VideoPollResult {
  status: VideoJobStatus;
  /** A real `data:` URI (decodable bytes), matching the established `GenerationResult.outputAssetUrls` convention — only present once `status === 'succeeded'`. */
  outputVideoUrl?: string;
  usageMetadata: Record<string, unknown>;
}
