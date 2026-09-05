import type { LockId } from '@avs/project-core';
import type { ProjectDNA } from '@avs/project-core';
import type { StructuredIntelligence } from './vision-analysis.js';

/** AI QC contract — docs/15_AI_QC_SPEC.md. */
export interface QCScores {
  architectureScore: number;
  cameraScore: number;
  materialScore: number;
  lightingScore: number;
  objectConsistencyScore: number;
  photorealismScore: number;
}

export interface QCIssue {
  attribute: string;
  region?: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
}

export interface QCResult {
  decision: 'pass' | 'fail';
  scores: QCScores;
  issues: QCIssue[];
  correctionInstruction: string | null;
}

/**
 * The engine compares real bytes it's handed, not a URL it fetches itself —
 * same real-bytes correction already applied to `GenerationRequest` at BUILD
 * 13 (apps/api only ever has relative `/assets/:id` paths; an engine fetching
 * an arbitrary caller-supplied URL would also be SSRF-shaped), and the same
 * reasoning as `SourceAssetRef`/`ReferenceAssetRef`.
 */
export interface QcAssetRef {
  data: Uint8Array;
  contentType: string;
}

/**
 * "Expected structured intent" (docs/15) QC compares the output against.
 * Deliberately a purpose-built subset of docs/03 §5's `NormalizedRequest`,
 * not that full type verbatim: `scenario`/`references`/`conflicts` steer
 * prompt COMPILATION (BUILD 09/11) but add nothing QC's own 6 scores (docs/15)
 * need to verify — including them here would just be dead weight the caller
 * has to thread across a network boundary. `enabledLocks` (not the full
 * `Lock[]` audit shape — tier/pinnedRef/history/etc.) is exactly what QC
 * needs to know: which source-fidelity/output-stability attributes must be
 * preserved (CLAUDE.md rules 2-4) versus which were explicitly allowed to
 * vary.
 */
export interface QcNormalizedRequestContext {
  structuredIntelligence: StructuredIntelligence;
  projectDNA: ProjectDNA;
  enabledLocks: LockId[];
  resolvedStyle: string;
  instructions: string[];
}

export interface AiQc {
  evaluate(params: {
    sourceAsset: QcAssetRef;
    outputAsset: QcAssetRef;
    normalizedRequest: QcNormalizedRequestContext;
  }): Promise<QCResult>;
}

/** Alias matching BUILD 02 service-boundary naming; same contract as AiQc. */
export type AIQCService = AiQc;
