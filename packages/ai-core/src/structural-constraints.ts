import type { SCENARIO_RESOLUTIONS } from './scenario-vocabulary.js';

/**
 * Structural Constraints — Architecture Amendment. Formalizes the
 * preservation principles the user's canonical Prompt DNA already relies on:
 * strict adherence to the reference sketch, structural integrity, exact
 * geometry, no hallucinated details, exact line-art translation,
 * photorealism, and target resolution. These map directly onto Architecture
 * Lock (docs/03 ADR-001) — when Architecture Lock is enabled, every boolean
 * here defaults true; disabling the lock is the only way any of them relax.
 *
 * `targetResolution` reuses docs/07's Resolution vocabulary
 * (scenario-vocabulary.ts) rather than redefining it, so the Scenario
 * Builder and Structural Constraints can never drift into two different
 * resolution vocabularies (CLAUDE.md "No duplicated business rules").
 */
export interface StructuralConstraints {
  strictlyAdhereToReferenceSketch: boolean;
  preserveStructuralIntegrity: boolean;
  preserveExactGeometry: boolean;
  noHallucinatedDetails: boolean;
  exactLineArtTranslation: boolean;
  photorealistic: boolean;
  targetResolution: (typeof SCENARIO_RESOLUTIONS)[number];
}

/** Default when Architecture Lock is enabled — the amendment's baseline, "preserve unless explicitly relaxed." */
export const DEFAULT_STRUCTURAL_CONSTRAINTS: StructuralConstraints = {
  strictlyAdhereToReferenceSketch: true,
  preserveStructuralIntegrity: true,
  preserveExactGeometry: true,
  noHallucinatedDetails: true,
  exactLineArtTranslation: true,
  photorealistic: true,
  targetResolution: '8K/Ultra',
};

/**
 * Derives StructuralConstraints from Architecture Lock state. Only the
 * GEOMETRIC-fidelity flags (adherence to the sketch, structural integrity,
 * exact geometry, exact line-art translation) relax when the lock is
 * disabled — an explicit, attributed user action (docs/06), never inferred.
 * `noHallucinatedDetails` and `photorealistic` are OUTPUT-QUALITY goals, not
 * source-fidelity constraints: even a deliberately creative reinterpretation
 * (lock disabled) shouldn't produce nonsensical artifacts or a non-photoreal
 * result, so those two stay true regardless of lock state.
 */
export function deriveStructuralConstraints(params: {
  architectureLockEnabled: boolean;
  targetResolution?: (typeof SCENARIO_RESOLUTIONS)[number];
}): StructuralConstraints {
  const resolution = params.targetResolution ?? DEFAULT_STRUCTURAL_CONSTRAINTS.targetResolution;
  if (params.architectureLockEnabled) {
    return { ...DEFAULT_STRUCTURAL_CONSTRAINTS, targetResolution: resolution };
  }
  return {
    strictlyAdhereToReferenceSketch: false,
    preserveStructuralIntegrity: false,
    preserveExactGeometry: false,
    noHallucinatedDetails: true,
    exactLineArtTranslation: false,
    photorealistic: true,
    targetResolution: resolution,
  };
}
