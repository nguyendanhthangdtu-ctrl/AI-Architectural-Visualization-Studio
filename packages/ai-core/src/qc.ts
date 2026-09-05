import { notImplemented } from './not-implemented.js';
import type { NormalizedRequest } from './reasoning-engine.js';

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

export interface AiQc {
  evaluate(params: {
    sourceAssetUrl: string;
    normalizedRequest: NormalizedRequest;
    outputAssetUrl: string;
  }): Promise<QCResult>;
}

export const aiQc: AiQc = {
  evaluate: async () => notImplemented('AiQc.evaluate', 'BUILD 17 — AI QC / Auto-Regeneration'),
};

/** Alias matching BUILD 02 service-boundary naming; same contract as AiQc. */
export type AIQCService = AiQc;
