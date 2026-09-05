import type { Timestamp, UserId } from '@avs/shared';

/**
 * Lock model — docs/03_TECHNICAL_ARCHITECTURE.md §1 ADR-001 and §7,
 * docs/04_DATA_MODEL.md Constraints, docs/06_REASONING_ENGINE_SPEC.md.
 */
export type LockId = 'architecture' | 'camera' | 'material' | 'style' | 'lighting';
export type LockTier = 'source-fidelity' | 'output-stability';

export interface AnalysisVersionRef {
  kind: 'analysis-version';
  analysisVersion: string;
}

export interface GenerationVersionRef {
  kind: 'generation-version';
  generationVersionId: string;
}

export type LockPinnedRef = AnalysisVersionRef | GenerationVersionRef | null;

export interface LockChangeEvent {
  enabled: boolean;
  setBy: UserId;
  setAt: Timestamp;
  reason?: string;
}

export interface Lock {
  id: LockId;
  tier: LockTier;
  enabled: boolean;
  pinnedRef: LockPinnedRef;
  setBy: UserId;
  setAt: Timestamp;
  reason?: string;
  history: LockChangeEvent[];
}

/** Alias matching docs/01 BUILD 02 domain-foundation naming; same type as Lock. */
export type LockState = Lock;

/** Fixed tier assignment — never derived, never user-configurable. */
export const LOCK_TIER: Readonly<Record<LockId, LockTier>> = {
  architecture: 'source-fidelity',
  camera: 'source-fidelity',
  material: 'source-fidelity',
  style: 'output-stability',
  lighting: 'output-stability',
};

/** Default enabled state at project creation — ADR-001: Tier A on, Tier B off. */
export const LOCK_DEFAULT_ENABLED: Readonly<Record<LockId, boolean>> = {
  architecture: true,
  camera: true,
  material: true,
  style: false,
  lighting: false,
};

/**
 * Builds the default lock set for a newly analyzed project, pinned to the
 * analysis snapshot that just produced Structured Intelligence. Style/Lighting
 * locks start unpinned since they are enabled later, against an accepted
 * GenerationVersion — never against the source analysis (ADR-001).
 */
export function createDefaultLocks(params: { analysisVersion: string; setBy: UserId; setAt: Timestamp }): Lock[] {
  return (Object.keys(LOCK_TIER) as LockId[]).map((id) => {
    const tier = LOCK_TIER[id];
    const enabled = LOCK_DEFAULT_ENABLED[id];
    const pinnedRef: LockPinnedRef =
      tier === 'source-fidelity' ? { kind: 'analysis-version', analysisVersion: params.analysisVersion } : null;
    return {
      id,
      tier,
      enabled,
      pinnedRef,
      setBy: params.setBy,
      setAt: params.setAt,
      history: [{ enabled, setBy: params.setBy, setAt: params.setAt, reason: 'project-created-default' }],
    };
  });
}

/**
 * Applies an explicit, attributed change to a lock. Never mutates in place —
 * returns a new Lock with the change appended to history (append-only audit
 * trail, CLAUDE.md rule 15: no silent data loss).
 */
export function applyLockChange(
  lock: Lock,
  change: { enabled: boolean; setBy: UserId; setAt: Timestamp; reason?: string; pinnedRef?: LockPinnedRef },
): Lock {
  const event: LockChangeEvent = {
    enabled: change.enabled,
    setBy: change.setBy,
    setAt: change.setAt,
    ...(change.reason !== undefined ? { reason: change.reason } : {}),
  };
  return {
    ...lock,
    enabled: change.enabled,
    setBy: change.setBy,
    setAt: change.setAt,
    ...(change.reason !== undefined ? { reason: change.reason } : {}),
    ...(change.pinnedRef !== undefined ? { pinnedRef: change.pinnedRef } : {}),
    history: [...lock.history, event],
  };
}
