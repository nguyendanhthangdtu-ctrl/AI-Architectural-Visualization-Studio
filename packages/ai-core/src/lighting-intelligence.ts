import type { LightingDNA } from '@avs/project-core';

/**
 * Lighting Intelligence — Architecture Amendment. Structures cinematic
 * lighting/exposure qualities for the Prompt Intelligence Engine, on top of
 * `LightingDNA` (project-core) by composition, not duplication.
 *
 * `moodTags` is an ILLUSTRATIVE, optional vocabulary — the amendment's
 * examples ("sunlight filtering through canopy leaves," "dappled light,"
 * "cinematic lighting," etc.) are preserved as available terms a real
 * analysis or reference MAY select, never values forced onto every image.
 */
export type LightingMoodTag =
  | 'clear-light'
  | 'sunlight-filtering-through-canopy'
  | 'dappled-light-on-surfaces'
  | 'evocative-shadows'
  | 'cinematic-lighting';

export const LIGHTING_MOOD_TAGS: readonly LightingMoodTag[] = [
  'clear-light',
  'sunlight-filtering-through-canopy',
  'dappled-light-on-surfaces',
  'evocative-shadows',
  'cinematic-lighting',
];

export type ExposureLevel = 'low' | 'medium' | 'high';
export type HighlightControl = 'controlled' | 'blown-out' | 'uncontrolled';
export type ShadowDetail = 'detailed' | 'crushed' | 'flat';
export type BlackLevel = 'clean' | 'muddy';
export type ContrastLevel = 'low' | 'medium' | 'medium-high' | 'high';
export type SpatialLayering = 'clear' | 'flat';

/**
 * The amendment's baseline exposure/contrast principles — "medium exposure
 * baseline, controlled highlights, detailed shadows, clean blacks,
 * medium-to-high contrast, clear spatial layering." This is the DEFAULT
 * profile, not an immutable rule: real analysis or an explicit user
 * preference may override any field.
 */
export interface ExposureProfile {
  exposureBaseline: ExposureLevel;
  highlightControl: HighlightControl;
  shadowDetail: ShadowDetail;
  blackLevel: BlackLevel;
  contrast: ContrastLevel;
  spatialLayering: SpatialLayering;
}

export const DEFAULT_EXPOSURE_PROFILE: ExposureProfile = {
  exposureBaseline: 'medium',
  highlightControl: 'controlled',
  shadowDetail: 'detailed',
  blackLevel: 'clean',
  contrast: 'medium-high',
  spatialLayering: 'clear',
};

export interface LightingIntelligence {
  dna: LightingDNA;
  moodTags: LightingMoodTag[];
  exposure: ExposureProfile;
}

/** Builds LightingIntelligence from LightingDNA, applying the default exposure baseline unless `exposureOverrides` supplies real values. */
export function buildLightingIntelligence(params: {
  dna: LightingDNA;
  moodTags?: LightingMoodTag[];
  exposureOverrides?: Partial<ExposureProfile>;
}): LightingIntelligence {
  return {
    dna: params.dna,
    moodTags: params.moodTags ?? [],
    exposure: { ...DEFAULT_EXPOSURE_PROFILE, ...params.exposureOverrides },
  };
}
