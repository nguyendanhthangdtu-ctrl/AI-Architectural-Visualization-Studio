import type { ErrorEnvelope } from '@avs/shared';

/**
 * Provider-agnostic generation contract — docs/10_MODEL_ADAPTER_SPEC.md,
 * docs/03_TECHNICAL_ARCHITECTURE.md §6. The core depends only on these types,
 * never on a provider SDK type.
 */
export interface AdapterCapabilities {
  maxResolution: string;
  supportedAspectRatios: string[];
  supportsEdit: boolean;
  supportsUpscale: boolean;
}

/**
 * Real bytes, not a URL the adapter fetches itself — corrected at BUILD 13
 * from the original BUILD 02 scaffolding's `sourceAssetUrls: string[]` /
 * `referenceAssetUrls: string[]`, which turned out unusable for a real
 * caller: `apps/api` only ever has *relative* `/assets/:id` paths (not a
 * fetchable absolute URL), and the caller already has the bytes from
 * `AssetStore.get()` anyway. Same rationale as `SourceAssetRef`
 * (vision-analysis.ts, BUILD 07) and `ReferenceAssetRef`
 * (reference-intelligence.ts, BUILD 10) — the caller hands over real bytes,
 * the adapter never fetches an arbitrary URL itself.
 */
export interface GenerationAssetRef {
  data: Uint8Array;
  contentType: string;
}

export interface GenerationRequest {
  requestId: string;
  promptText: string;
  sourceAssets: GenerationAssetRef[];
  referenceAssets: GenerationAssetRef[];
  aspectRatio: string;
  resolution: string;
  seed?: number;
}

export interface GenerationResult {
  status: 'succeeded' | 'failed';
  outputAssetUrls: string[];
  usageMetadata: Record<string, unknown>;
  providerJobId?: string;
}

/**
 * Advanced Editor request (BUILD 14, docs/12) — edits an EXISTING output,
 * never the original source. `maskAsset` is a real pixel region (PNG, fully
 * transparent = editable, matching the OpenAI Images Edit API's own mask
 * semantics) when a caller supplies one; without it, an adapter treats the
 * whole image as editable, constrained only by `promptText`. No freehand
 * mask-drawing UI exists yet (BUILD 14 scope) — `maskAsset` is real,
 * end-to-end plumbing ahead of that UI, not a placeholder.
 */
export interface EditRequest {
  requestId: string;
  promptText: string;
  sourceAsset: GenerationAssetRef;
  maskAsset?: GenerationAssetRef;
  aspectRatio: string;
  resolution: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface NormalizedAdapterError extends ErrorEnvelope {
  retryable: boolean;
}
