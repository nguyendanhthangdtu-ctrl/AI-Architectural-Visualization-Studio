/**
 * Project DNA — docs/04_DATA_MODEL.md "Project DNA". Structured facts captured
 * by the Vision Analysis Engine (BUILD 07) and preserved per the Lock model
 * (lock.ts), derived into this shape by the Reasoning Engine (BUILD 08,
 * packages/ai-core/project-dna-mapping.ts — "Propagate Project DNA," docs/06).
 *
 * CameraDNA.eyeLevel/verticalCorrection, MaterialDNA's roughness/reflectance,
 * and LightingDNA's intensity/softness/colorTemperature are typed as
 * qualitative strings, not numbers — BUILD 02 guessed numeric measurements
 * here, but a vision-language model reports these qualitatively ("standing
 * eye level", "low roughness", "warm"), not as precise measured values.
 * Corrected at BUILD 08 when this shape was first actually populated.
 */
export interface ArchitectureDNA {
  geometry: Record<string, unknown>;
  openings: Record<string, unknown>;
  roof: Record<string, unknown>;
  facade: Record<string, unknown>;
  floorPlan: Record<string, unknown>;
  ceiling: Record<string, unknown>;
  stairs: Record<string, unknown>;
  proportions: Record<string, unknown>;
}

export interface InteriorDNA {
  spatialLayout: Record<string, unknown>;
  walls: Record<string, unknown>;
  floor: Record<string, unknown>;
  ceiling: Record<string, unknown>;
  furnitureLayout: Record<string, unknown>;
}

export interface CameraDNA {
  height: number | null;
  lens: string | null;
  fieldOfView: number | null;
  perspective: string | null;
  eyeLevel: string | null;
  projection: string | null;
  verticalCorrection: string | null;
}

export interface MaterialDNA {
  assignments: Record<string, { type: string; finish: string; roughness: string; reflectance: string }>;
}

export interface LightingDNA {
  direction: string | null;
  timeOfDay: string | null;
  intensity: string | null;
  softness: string | null;
  colorTemperature: string | null;
  artificialLighting: string[];
}

export interface EnvironmentDNA {
  setting: string | null;
  sky: string | null;
  weather: string | null;
  context: string | null;
}

export interface ReferenceDNA {
  referenceAssetIds: string[];
}

/**
 * architectureDNA/interiorDNA are genuinely module-conditional (only one is
 * ever populated, per docs/00 Architecture/Interior modules) and
 * referenceDNA is only populated once Reference Intelligence (BUILD 10)
 * exists — those three stay nullable. camera/material/lighting/environment
 * are populated by every real analysis regardless of module (BUILD 08
 * project-dna-mapping.ts), so they're non-nullable once real analysis exists.
 */
export interface ProjectDNA {
  architectureDNA: ArchitectureDNA | null;
  interiorDNA: InteriorDNA | null;
  cameraDNA: CameraDNA;
  materialDNA: MaterialDNA;
  lightingDNA: LightingDNA;
  environmentDNA: EnvironmentDNA;
  referenceDNA: ReferenceDNA | null;
}
