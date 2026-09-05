import type { CameraDNA } from '@avs/project-core';

/**
 * Camera Intelligence — Architecture Amendment. Structures camera
 * characteristics for the Prompt Intelligence Engine, built ON TOP OF
 * `CameraDNA` (project-core) by composition, not duplication — `dna` is the
 * single source of the raw observed/preserved facts; the fields here are a
 * richer, prompt-oriented classification of that same data.
 */
export type LensCharacteristic = 'wide-angle' | 'standard' | 'telephoto' | 'orthographic';
export type PerspectiveType = 'one-point' | 'two-point' | 'three-point';

export interface CameraIntelligence {
  dna: CameraDNA;
  lensCharacteristic: LensCharacteristic | null;
  perspectiveType: PerspectiveType | null;
  /**
   * An illustrative camera-system reference (e.g. "ARRI Alexa Mini LF /
   * Cooke Panchro") — descriptive vocabulary a prompt MAY use, never a
   * mandatory hardcoded value. Null unless the source analysis, a reference,
   * or an explicit user preference actually supplied one.
   */
  illustrativeCameraSystem: string | null;
  /** True when the source is a SketchUp/3ds Max viewport and Camera Lock is enabled — docs/06, docs/03 ADR-001. */
  preserveOriginalCamera: boolean;
}

/**
 * Builds CameraIntelligence from CameraDNA — pure, no inference beyond what
 * the DNA already states. `illustrativeCameraSystem` stays null here: no
 * analysis or reference has run yet at this layer to have suggested one.
 */
export function buildCameraIntelligence(params: {
  dna: CameraDNA;
  cameraLockEnabled: boolean;
  isViewportSource: boolean;
}): CameraIntelligence {
  return {
    dna: params.dna,
    lensCharacteristic: classifyLens(params.dna.lens),
    perspectiveType: classifyPerspective(params.dna.projection),
    illustrativeCameraSystem: null,
    preserveOriginalCamera: params.isViewportSource && params.cameraLockEnabled,
  };
}

function classifyLens(lens: string | null): LensCharacteristic | null {
  if (!lens) return null;
  const normalized = lens.toLowerCase();
  if (normalized.includes('wide')) return 'wide-angle';
  if (normalized.includes('tele')) return 'telephoto';
  if (normalized.includes('ortho')) return 'orthographic';
  if (normalized.includes('standard') || normalized.includes('normal')) return 'standard';
  return null;
}

function classifyPerspective(projection: string | null): PerspectiveType | null {
  if (!projection) return null;
  const normalized = projection.toLowerCase();
  if (normalized.includes('three') || normalized.includes('3-point') || normalized.includes('3 point')) {
    return 'three-point';
  }
  if (normalized.includes('two') || normalized.includes('2-point') || normalized.includes('2 point')) {
    return 'two-point';
  }
  if (normalized.includes('one') || normalized.includes('1-point') || normalized.includes('1 point')) {
    return 'one-point';
  }
  return null;
}
