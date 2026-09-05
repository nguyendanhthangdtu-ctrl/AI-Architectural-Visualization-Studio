import type { Lock, LockId } from '@avs/project-core';
import { LOCK_TIER } from '@avs/project-core';
import type { LightingDNA, ProjectDNA } from '@avs/project-core';
import { DomainError } from '@avs/shared';
import { deriveProjectDNA } from './project-dna-mapping.js';
import type { StructuredIntelligence } from './vision-analysis.js';
import type { NormalizedScenario } from './scenario.js';
import type { ExtractedVisualLanguage } from './reference-intelligence.js';

/**
 * Reasoning Engine — docs/06_REASONING_ENGINE_SPEC.md, priority order amended
 * by docs/03_TECHNICAL_ARCHITECTURE.md ADR-001 (Tier A locks at priority 2;
 * Tier B locks pin only the style/lighting sub-fields of tiers 4-6).
 *
 * A conflict is NEVER resolved silently (docs/06 "never override explicit
 * locks without an explicit user action") — every override this engine makes
 * is recorded in `conflicts`, always in the caller's response, never only in
 * a log.
 */
export type ConflictField = 'architecture' | 'camera' | 'material' | 'style' | 'lighting';
export type ConflictSeverity = 'info' | 'warning';

export interface ResolvedConflict {
  field: ConflictField;
  reason: string;
  resolution: string;
  severity: ConflictSeverity;
}

/**
 * Values a Tier B (output-stability) lock pins to, when enabled — the
 * previously-accepted values docs/03 ADR-001 says it preserves. ai-core has
 * no I/O (no VersionRepository access), so the caller (apps/api) must
 * resolve the lock's `GenerationVersionRef` into real values before calling
 * `resolve()`. Omitting a field the corresponding lock needs is not an
 * error — it becomes a `warning`-severity conflict, never a silent no-op.
 */
export interface OutputStabilityPins {
  style?: string;
  lightingDNA?: Partial<LightingDNA>;
}

export interface ReasoningEngineInput {
  structuredIntelligence: StructuredIntelligence;
  locks: Lock[];
  scenario: NormalizedScenario;
  references: ExtractedVisualLanguage[];
  instructions: string[];
  pinnedOutputStability?: OutputStabilityPins;
}

export interface NormalizedRequest {
  structuredIntelligence: StructuredIntelligence;
  projectDNA: ProjectDNA;
  resolvedStyle: string;
  /** May differ from the input scenario — e.g. cameraMode forced to 'Preserve Original' under Camera Lock. */
  scenario: NormalizedScenario;
  locks: Lock[];
  references: ExtractedVisualLanguage[];
  instructions: string[];
  conflicts: ResolvedConflict[];
}

export interface ReasoningEngine {
  resolve(input: ReasoningEngineInput): Promise<NormalizedRequest>;
}

const REFERENCE_PURPOSE_BY_TIER_A_FIELD: Record<'camera' | 'material', ExtractedVisualLanguage['purpose'][]> = {
  camera: ['camera'],
  material: ['material'],
};

function findLock(locks: Lock[], id: LockId): Lock {
  const lock = locks.find((l) => l.id === id);
  if (!lock) {
    throw new DomainError({
      code: 'INVALID_LOCK_SET',
      message: `Missing lock "${id}" — a complete 5-lock set (docs/03 ADR-001) is required to resolve a request.`,
      retryable: false,
    });
  }
  if (lock.tier !== LOCK_TIER[id]) {
    throw new DomainError({
      code: 'INVALID_LOCK_SET',
      message: `Lock "${id}" has tier "${lock.tier}" but must be "${LOCK_TIER[id]}" (docs/03 ADR-001) — never derived, never user-configurable.`,
      retryable: false,
    });
  }
  return lock;
}

function resolveSourceFidelityField(params: {
  field: ConflictField;
  lock: Lock;
  scenarioConflict?: { reason: string } | null;
  referencePurposes: ExtractedVisualLanguage['purpose'][];
  conflicts: ResolvedConflict[];
}): void {
  const { field, lock, scenarioConflict, referencePurposes, conflicts } = params;

  if (!lock.enabled) {
    conflicts.push({
      field,
      reason: `${field} Lock is disabled (explicit user action).`,
      resolution: `${field} may vary freely with scenario/reference/creative input.`,
      severity: 'info',
    });
    return;
  }

  if (scenarioConflict) {
    conflicts.push({
      field,
      reason: scenarioConflict.reason,
      resolution: `${field} Lock is enabled — kept the source-observed value, ignored the conflicting scenario input.`,
      severity: 'warning',
    });
  }

  if (referencePurposes.length > 0) {
    conflicts.push({
      field,
      reason: `Reference(s) with purpose ${referencePurposes.join(', ')} would influence ${field}.`,
      resolution: `${field} Lock is enabled — suppressed that reference influence, kept the source-observed value.`,
      severity: 'warning',
    });
  }
}

export const reasoningEngine: ReasoningEngine = {
  async resolve(input: ReasoningEngineInput): Promise<NormalizedRequest> {
    // Tier 1 — safety/system constraints: the lock set itself must be well-formed before anything else runs.
    const architectureLock = findLock(input.locks, 'architecture');
    const cameraLock = findLock(input.locks, 'camera');
    const materialLock = findLock(input.locks, 'material');
    const styleLock = findLock(input.locks, 'style');
    const lightingLock = findLock(input.locks, 'lighting');

    const conflicts: ResolvedConflict[] = [];
    const projectDNA = deriveProjectDNA(input.structuredIntelligence);
    const layers = input.structuredIntelligence.layers;

    // Tier 2 (source-fidelity) vs tiers 3-6 — Architecture.
    if (input.structuredIntelligence.layers.architecture.confidence < 0.5) {
      conflicts.push({
        field: 'architecture',
        reason: `Architecture analysis confidence is low (${layers.architecture.confidence}).`,
        resolution: architectureLock.enabled
          ? 'Architecture Lock is enabled — preserving the low-confidence observation anyway; review before relying on it.'
          : 'Architecture Lock is disabled and the observation is low-confidence — architecture may vary significantly.',
        severity: 'warning',
      });
    } else if (!architectureLock.enabled) {
      conflicts.push({
        field: 'architecture',
        reason: 'Architecture Lock is disabled (explicit user action).',
        resolution: 'Architecture may vary freely with scenario/reference/creative input.',
        severity: 'info',
      });
    }

    // Camera.
    const cameraScenarioConflict =
      input.scenario.cameraMode && input.scenario.cameraMode !== 'Preserve Original'
        ? { reason: `Scenario requested camera mode "${input.scenario.cameraMode}".` }
        : null;
    resolveSourceFidelityField({
      field: 'camera',
      lock: cameraLock,
      scenarioConflict: cameraScenarioConflict,
      referencePurposes: input.references
        .filter((r) => REFERENCE_PURPOSE_BY_TIER_A_FIELD.camera.includes(r.purpose))
        .map((r) => r.purpose),
      conflicts,
    });
    const resolvedScenario: NormalizedScenario =
      cameraLock.enabled && cameraScenarioConflict
        ? { ...input.scenario, cameraMode: 'Preserve Original' }
        : input.scenario;

    // Material.
    resolveSourceFidelityField({
      field: 'material',
      lock: materialLock,
      referencePurposes: input.references
        .filter((r) => REFERENCE_PURPOSE_BY_TIER_A_FIELD.material.includes(r.purpose))
        .map((r) => r.purpose),
      conflicts,
    });

    // Tier B — Style (docs/03 ADR-001: pins only the style sub-field of tiers 4-6, never outranks Tier A).
    const sourceStyle = layers.style.data.style;
    let resolvedStyle = sourceStyle;
    if (styleLock.enabled) {
      if (input.pinnedOutputStability?.style) {
        resolvedStyle = input.pinnedOutputStability.style;
        if (resolvedStyle !== sourceStyle) {
          conflicts.push({
            field: 'style',
            reason: `Freshly observed style "${sourceStyle}" differs from the previously accepted "${resolvedStyle}".`,
            resolution: 'Style Lock is enabled — kept the previously accepted style.',
            severity: 'info',
          });
        }
      } else {
        conflicts.push({
          field: 'style',
          reason: 'Style Lock is enabled but no previously accepted style value was supplied.',
          resolution:
            'Falling back to the freshly observed style — Style Lock could not actually be honored this time.',
          severity: 'warning',
        });
      }
    }

    // Tier B — Lighting.
    let lightingDNA = projectDNA.lightingDNA;
    if (lightingLock.enabled) {
      if (input.pinnedOutputStability?.lightingDNA) {
        lightingDNA = { ...projectDNA.lightingDNA, ...input.pinnedOutputStability.lightingDNA } as LightingDNA;
        conflicts.push({
          field: 'lighting',
          reason: 'Lighting Lock is enabled.',
          resolution: 'Applied the previously accepted lighting values over the freshly observed lighting.',
          severity: 'info',
        });
      } else {
        conflicts.push({
          field: 'lighting',
          reason: 'Lighting Lock is enabled but no previously accepted lighting values were supplied.',
          resolution:
            'Falling back to the freshly observed lighting — Lighting Lock could not actually be honored this time.',
          severity: 'warning',
        });
      }
    } else if (input.scenario.lighting) {
      // Unlocked: tier 4 (user scenario) outranks tier 3 (source DNA) — docs/06 priority order.
      lightingDNA = { ...projectDNA.lightingDNA, timeOfDay: input.scenario.lighting };
      conflicts.push({
        field: 'lighting',
        reason: `Scenario requested lighting "${input.scenario.lighting}".`,
        resolution:
          'Lighting Lock is disabled — applied the scenario lighting choice over the source-observed lighting.',
        severity: 'info',
      });
    }

    return {
      structuredIntelligence: input.structuredIntelligence,
      projectDNA: { ...projectDNA, lightingDNA },
      resolvedStyle,
      scenario: resolvedScenario,
      locks: input.locks,
      references: input.references,
      instructions: input.instructions,
      conflicts,
    };
  },
};

/** Alias matching BUILD 02 service-boundary naming; same contract as ReasoningEngine. */
export type ReasoningService = ReasoningEngine;
