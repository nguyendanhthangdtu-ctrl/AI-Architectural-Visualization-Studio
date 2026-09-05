import type { Timestamp, UserId } from '@avs/shared';

/**
 * Append-only version DAG — docs/03_TECHNICAL_ARCHITECTURE.md ADR-006, §7.
 * Every analysis, scenario resolution, generation, edit, and view creates one
 * of these, linked to its parent. Never mutated or overwritten in place.
 */
export type GenerationVersionKind = 'analysis' | 'scenario' | 'generation' | 'edit' | 'view' | 'video';

export interface GenerationVersion {
  id: string;
  projectId: string;
  parentVersionId: string | null;
  kind: GenerationVersionKind;
  snapshotRef: string;
  createdAt: Timestamp;
  createdBy: UserId;
}
