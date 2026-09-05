import type { CameraDNA, LightingDNA, MaterialDNA } from '@avs/project-core';
import type { ConflictField, NormalizedRequest, ResolvedConflict } from './reasoning-engine.js';

/**
 * Multi-View — docs/13_MULTIVIEW_SPEC.md (BUILD 15).
 *
 * Deliberately NOT a change to `reasoning-engine.ts`'s tested lock-precedence
 * behavior (BUILD 08) — a View takes an ALREADY-RESOLVED `NormalizedRequest`
 * and derives a second, request-scoped variant from it. Both modes reuse the
 * exact same downstream pipeline a normal Render does (BUILD 11 compile,
 * BUILD 13 generate) — a View is "resolve a modified request, then generate
 * again," not a separate generation mechanism.
 *
 * "Sync View: change camera while preserving Project DNA and locked
 * attributes" — only `camera` may change; a material/lighting/style proposal
 * is structurally ignored (recorded as a conflict, not silently dropped).
 * "Creative View: generate alternative camera/composition proposals while
 * preserving Architecture DNA" — camera/material/lighting/style may all
 * change; architecture never can, because `ViewProposal` has no field for it
 * — the same "no field to abuse" pattern already used for
 * `source-reference-separation.ts`'s architecture protection.
 */
export type ViewMode = 'sync' | 'creative';

export interface ViewProposal {
  camera?: Partial<CameraDNA>;
  material?: Partial<MaterialDNA>;
  lighting?: Partial<LightingDNA>;
  style?: string;
}

export interface ViewResolution {
  request: NormalizedRequest;
  conflicts: ResolvedConflict[];
  /** Proposal fields a Sync View received but structurally ignored (docs/13 "preserving... locked attributes"). Always empty for Creative View. */
  ignoredProposals: ConflictField[];
}

const CHANGEABLE_FIELDS_BY_MODE: Record<ViewMode, readonly ConflictField[]> = {
  sync: ['camera'],
  creative: ['camera', 'material', 'style', 'lighting'],
};

/**
 * `enabled: false` here is an ephemeral, request-scoped snapshot for THIS
 * view's compilation only — never a real, attributed change to the
 * project's persisted `Lock` record (that would need `applyLockChange`,
 * lock.ts). Without this, a compiled prompt could say both "target camera:
 * ..." and "Camera Lock enabled — preserve the original camera exactly" for
 * the same request — an internally contradictory instruction.
 */
function withLocksOpenedFor(request: NormalizedRequest, fields: readonly ConflictField[]): NormalizedRequest['locks'] {
  if (fields.length === 0) return request.locks;
  return request.locks.map((lock) => (fields.includes(lock.id) ? { ...lock, enabled: false } : lock));
}

function resolveSyncView(base: NormalizedRequest, proposal: ViewProposal): ViewResolution {
  const conflicts: ResolvedConflict[] = [...base.conflicts];
  const ignoredProposals: ConflictField[] = [];

  (['material', 'lighting'] as const).forEach((field) => {
    if (proposal[field] !== undefined) {
      ignoredProposals.push(field);
      conflicts.push({
        field,
        reason: `Sync View received a ${field} proposal.`,
        resolution: 'Sync View preserves Project DNA and locked attributes — only the camera changes; the proposal was ignored.',
        severity: 'warning',
      });
    }
  });
  if (proposal.style !== undefined) {
    ignoredProposals.push('style');
    conflicts.push({
      field: 'style',
      reason: 'Sync View received a style proposal.',
      resolution: 'Sync View preserves Project DNA and locked attributes — only the camera changes; the proposal was ignored.',
      severity: 'warning',
    });
  }

  const changedFields = proposal.camera ? CHANGEABLE_FIELDS_BY_MODE.sync : [];
  const cameraDNA = proposal.camera ? { ...base.projectDNA.cameraDNA, ...proposal.camera } : base.projectDNA.cameraDNA;

  return {
    request: {
      ...base,
      projectDNA: { ...base.projectDNA, cameraDNA },
      locks: withLocksOpenedFor(base, changedFields),
      conflicts,
    },
    conflicts,
    ignoredProposals,
  };
}

function resolveCreativeView(base: NormalizedRequest, proposal: ViewProposal): ViewResolution {
  const changedFields: ConflictField[] = [];
  if (proposal.camera) changedFields.push('camera');
  if (proposal.material) changedFields.push('material');
  if (proposal.lighting) changedFields.push('lighting');
  if (proposal.style !== undefined) changedFields.push('style');

  const conflicts: ResolvedConflict[] = [
    ...base.conflicts,
    ...changedFields.map((field) => ({
      field,
      reason: `Creative View proposal for ${field}.`,
      resolution: `${field} Lock (if enabled) is overridden for this Creative View — Architecture DNA is still preserved exactly.`,
      severity: 'info' as const,
    })),
  ];

  const cameraDNA = proposal.camera ? { ...base.projectDNA.cameraDNA, ...proposal.camera } : base.projectDNA.cameraDNA;
  const materialDNA = proposal.material
    ? { assignments: { ...base.projectDNA.materialDNA.assignments, ...(proposal.material.assignments ?? {}) } }
    : base.projectDNA.materialDNA;
  const lightingDNA = proposal.lighting ? { ...base.projectDNA.lightingDNA, ...proposal.lighting } : base.projectDNA.lightingDNA;
  const resolvedStyle = proposal.style ?? base.resolvedStyle;

  return {
    request: {
      ...base,
      // architectureDNA/interiorDNA are never touched — ViewProposal has no field for them.
      projectDNA: { ...base.projectDNA, cameraDNA, materialDNA, lightingDNA },
      resolvedStyle,
      locks: withLocksOpenedFor(base, changedFields),
      conflicts,
    },
    conflicts,
    ignoredProposals: [],
  };
}

export function resolveView(params: { baseRequest: NormalizedRequest; mode: ViewMode; proposal: ViewProposal }): ViewResolution {
  return params.mode === 'sync'
    ? resolveSyncView(params.baseRequest, params.proposal)
    : resolveCreativeView(params.baseRequest, params.proposal);
}
