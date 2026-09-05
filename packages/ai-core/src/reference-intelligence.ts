/**
 * Reference Intelligence contract — docs/08_REFERENCE_INTELLIGENCE.md.
 * Structurally enforces CLAUDE.md rule 5: only fields relevant to `purpose`
 * are ever populated — reference never transmits source architecture. See
 * `reference-field-vocabulary.ts` for the enforced field vocabulary and
 * `gemini-reference-engine.ts` (BUILD 10) for the real implementation.
 */
export type ReferencePurpose =
  | 'style'
  | 'material'
  | 'lighting'
  | 'composition'
  | 'camera'
  | 'environment'
  | 'furniture'
  | 'color'
  | 'overall-look'
  | 'auto';

export interface ExtractedVisualLanguage {
  purpose: ReferencePurpose;
  weight: number;
  fields: Record<string, unknown>;
}

/**
 * The engine analyzes real bytes it's handed, not a URL it fetches itself —
 * same SSRF-safety rationale as `VisionAnalysisEngine.analyze` (vision-analysis.ts):
 * the caller (apps/api) already has the bytes from AssetStore.get(). The
 * original BUILD 02 scaffolding took a bare `referenceAssetUrl: string`,
 * which this gate corrects to match the established, documented pattern —
 * an engine that fetches an arbitrary caller-supplied URL is an SSRF-shaped
 * design (CLAUDE.md rule 8: real, documented reason to change scaffolding).
 */
export interface ReferenceAssetRef {
  assetId: string;
  data: Uint8Array;
  contentType: string;
}

export interface ReferenceIntelligence {
  extract(referenceAsset: ReferenceAssetRef, purpose: ReferencePurpose): Promise<ExtractedVisualLanguage>;
}

/** Alias matching BUILD 02 service-boundary naming; same contract as ReferenceIntelligence. */
export type ReferenceIntelligenceService = ReferenceIntelligence;
