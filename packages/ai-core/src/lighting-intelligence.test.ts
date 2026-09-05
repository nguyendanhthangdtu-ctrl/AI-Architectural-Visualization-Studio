import { describe, expect, it } from 'vitest';
import type { LightingDNA } from '@avs/project-core';
import { buildLightingIntelligence, DEFAULT_EXPOSURE_PROFILE, LIGHTING_MOOD_TAGS } from './lighting-intelligence.js';

function dna(): LightingDNA {
  return {
    direction: 'front',
    timeOfDay: 'golden hour',
    intensity: 'medium',
    softness: 'soft',
    colorTemperature: 'warm',
    artificialLighting: [],
  };
}

describe('buildLightingIntelligence', () => {
  it('reuses LightingDNA by composition rather than duplicating its fields', () => {
    const lightingDna = dna();
    const result = buildLightingIntelligence({ dna: lightingDna });
    expect(result.dna).toBe(lightingDna);
  });

  it('applies the documented default exposure baseline when no override is supplied', () => {
    const result = buildLightingIntelligence({ dna: dna() });
    expect(result.exposure).toEqual(DEFAULT_EXPOSURE_PROFILE);
    expect(result.exposure).toEqual({
      exposureBaseline: 'medium',
      highlightControl: 'controlled',
      shadowDetail: 'detailed',
      blackLevel: 'clean',
      contrast: 'medium-high',
      spatialLayering: 'clear',
    });
  });

  it('lets a real override win over the default for that field only', () => {
    const result = buildLightingIntelligence({ dna: dna(), exposureOverrides: { contrast: 'high' } });
    expect(result.exposure.contrast).toBe('high');
    expect(result.exposure.exposureBaseline).toBe('medium'); // untouched fields keep the default
  });

  it('defaults moodTags to empty — illustrative vocabulary is optional, never forced onto every image', () => {
    const result = buildLightingIntelligence({ dna: dna() });
    expect(result.moodTags).toEqual([]);
  });

  it('accepts real mood tags from the amendment\'s preserved vocabulary', () => {
    const result = buildLightingIntelligence({ dna: dna(), moodTags: ['dappled-light-on-surfaces', 'cinematic-lighting'] });
    expect(result.moodTags).toEqual(['dappled-light-on-surfaces', 'cinematic-lighting']);
    for (const tag of result.moodTags) {
      expect(LIGHTING_MOOD_TAGS).toContain(tag);
    }
  });

  it('preserves every amendment-specified mood tag in the closed vocabulary', () => {
    expect(LIGHTING_MOOD_TAGS).toEqual([
      'clear-light',
      'sunlight-filtering-through-canopy',
      'dappled-light-on-surfaces',
      'evocative-shadows',
      'cinematic-lighting',
    ]);
  });
});
