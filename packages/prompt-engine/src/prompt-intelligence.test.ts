import { describe, expect, it } from 'vitest';
import { createDefaultLocks, type Lock } from '@avs/project-core';
import type { Timestamp, UserId } from '@avs/shared';
import type { NormalizedRequest, StructuredIntelligence } from '@avs/ai-core';
import { mapNormalizedRequestToPromptIntelligence } from './prompt-intelligence.js';

const now = '2026-09-04T00:00:00.000Z' as Timestamp;
const userId = 'u1' as UserId;

function structuredIntelligence(): StructuredIntelligence {
  return {
    analysisVersion: 'test:v1',
    module: 'architecture',
    layers: {
      subject: { confidence: 0.9, warnings: [], data: { type: 'building', description: 'A modern villa.' } },
      architecture: {
        confidence: 0.8,
        warnings: [],
        data: {
          geometry: 'boxy',
          openings: 'large glazing',
          roof: 'flat',
          facade: 'cladding',
          floorPlan: 'open',
          ceiling: 'flat',
          stairs: 'none visible',
          proportions: 'balanced',
        },
      },
      style: { confidence: 0.7, warnings: [], data: { style: 'Modern Contemporary', influences: [] } },
      camera: {
        confidence: 0.6,
        warnings: [],
        data: {
          heightMeters: 1.6,
          lens: 'wide-angle',
          fieldOfViewDegrees: 60,
          perspective: 'eye level',
          eyeLevel: 'standing',
          projection: 'two-point perspective',
          verticalCorrection: 'none',
        },
      },
      composition: {
        confidence: 0.7,
        warnings: [],
        data: { leadingLines: '', ruleOfThirds: '', goldenRatio: '', symmetry: '', balance: '', negativeSpace: '', hierarchy: '' },
      },
      material: {
        confidence: 0.6,
        warnings: [],
        data: { materials: [{ surface: 'wall', type: 'concrete', finish: 'smooth', roughness: 'low', reflectance: 'low' }] },
      },
      lighting: {
        confidence: 0.5,
        warnings: [],
        data: {
          direction: 'front',
          timeOfDay: 'golden hour',
          intensity: 'medium',
          softness: 'soft',
          shadows: 'soft',
          colorTemperature: 'warm',
          artificialLighting: [],
        },
      },
      environment: { confidence: 0.6, warnings: [], data: { setting: 'urban', sky: 'clear', weather: 'sunny', context: 'street' } },
      object: { confidence: 0.5, warnings: [], data: { objects: [] } },
      photography: {
        confidence: 0.6,
        warnings: [],
        data: { cameraSystemLook: '', lensBehavior: '', exposure: '', dynamicRange: '', depth: '', imperfections: '' },
      },
      realLifeLook: { confidence: 0.7, warnings: [], data: { description: 'professional' } },
      constraints: { confidence: 0.9, warnings: [], data: { notedUncertainties: [] } },
    },
  };
}

function locks(overrides: Partial<Record<Lock['id'], boolean>> = {}): Lock[] {
  const base = createDefaultLocks({ analysisVersion: 'test:v1', setBy: userId, setAt: now });
  return base.map((lock) => (overrides[lock.id] !== undefined ? { ...lock, enabled: overrides[lock.id]! } : lock));
}

function buildRequest(): NormalizedRequest {
  return {
    structuredIntelligence: structuredIntelligence(),
    projectDNA: {
      architectureDNA: { geometry: { description: 'boxy' }, openings: {}, roof: {}, facade: {}, floorPlan: {}, ceiling: {}, stairs: {}, proportions: {} },
      interiorDNA: null,
      cameraDNA: { height: 1.6, lens: 'wide-angle', fieldOfView: 60, perspective: 'eye level', eyeLevel: 'standing', projection: 'two-point perspective', verticalCorrection: 'none' },
      materialDNA: { assignments: { wall: { type: 'concrete', finish: 'smooth', roughness: 'low', reflectance: 'low' } } },
      lightingDNA: { direction: 'front', timeOfDay: 'golden hour', intensity: 'medium', softness: 'soft', colorTemperature: 'warm', artificialLighting: [] },
      environmentDNA: { setting: 'urban', sky: 'clear', weather: 'sunny', context: 'street' },
      referenceDNA: null,
    },
    resolvedStyle: 'Modern Contemporary',
    scenario: {
      context: 'Residential',
      lighting: '',
      sunDirection: 'Auto',
      artificialLighting: [],
      environment: 'Clear sky',
      cameraMode: 'Preserve Original',
      aspectRatio: '2:3',
      generationResolution: '2K',
      upscaleResolution: '4K',
      renderCore: 'Auto',
      normalizedAt: now,
    },
    locks: locks(),
    references: [],
    instructions: [],
    conflicts: [],
  };
}

describe('mapNormalizedRequestToPromptIntelligence — 12-layer → canonical structure mapping', () => {
  it('maps the architecture module source DNA into sourceArchitecture (highest priority)', () => {
    const result = mapNormalizedRequestToPromptIntelligence(buildRequest(), { analysisLanguage: 'en', outputLanguage: 'auto' });
    expect(result.sourceArchitecture).not.toBeNull();
    expect(result.sourceArchitecture?.geometry).toEqual({ description: 'boxy' });
  });

  it('never maps sourceArchitecture for the interior module — architecture DNA is module-conditional', () => {
    const request = buildRequest();
    request.structuredIntelligence.module = 'interior';
    const result = mapNormalizedRequestToPromptIntelligence(request, { analysisLanguage: 'en', outputLanguage: 'auto' });
    expect(result.sourceArchitecture).toBeNull();
  });

  it('maps camera layer data into structured CameraIntelligence, classifying lens/perspective', () => {
    const result = mapNormalizedRequestToPromptIntelligence(buildRequest(), { analysisLanguage: 'en', outputLanguage: 'auto' });
    expect(result.camera.dna.height).toBe(1.6);
    expect(result.camera.lensCharacteristic).toBe('wide-angle');
    expect(result.camera.perspectiveType).toBe('two-point');
  });

  it('maps lighting DNA into structured LightingIntelligence with the default exposure profile', () => {
    const result = mapNormalizedRequestToPromptIntelligence(buildRequest(), { analysisLanguage: 'en', outputLanguage: 'auto' });
    expect(result.lighting.dna.timeOfDay).toBe('golden hour');
    expect(result.lighting.exposure.contrast).toBe('medium-high');
  });

  it('derives StructuralConstraints from Architecture Lock, matching BUILD 08 lock precedence', () => {
    const enabled = mapNormalizedRequestToPromptIntelligence(buildRequest(), { analysisLanguage: 'en', outputLanguage: 'auto' });
    expect(enabled.technicalConstraints.preserveExactGeometry).toBe(true);

    const requestWithLockOff = buildRequest();
    requestWithLockOff.locks = locks({ architecture: false });
    const disabled = mapNormalizedRequestToPromptIntelligence(requestWithLockOff, { analysisLanguage: 'en', outputLanguage: 'auto' });
    expect(disabled.technicalConstraints.preserveExactGeometry).toBe(false);
  });

  it('honestly mirrors single-language text into both en/vi with a warning — never fakes a translation', () => {
    const result = mapNormalizedRequestToPromptIntelligence(buildRequest(), { analysisLanguage: 'en', outputLanguage: 'auto' });
    expect(result.subject.en).toBe('A modern villa.');
    expect(result.subject.vi).toBe('A modern villa.'); // mirrored, not translated
    expect(result.subject.warnings).toContain(
      'Not translated — single-language source text pending real bilingual generation (BUILD 11).',
    );
  });

  it('carries the resolved language configuration through', () => {
    const result = mapNormalizedRequestToPromptIntelligence(buildRequest(), { analysisLanguage: 'vi', outputLanguage: 'en' });
    expect(result.language).toEqual({ analysisLanguage: 'vi', outputLanguage: 'en' });
  });

  it('defaults userPreferenceContribution to empty when none is supplied', () => {
    const result = mapNormalizedRequestToPromptIntelligence(buildRequest(), { analysisLanguage: 'en', outputLanguage: 'auto' });
    expect(result.userPreferenceContribution).toEqual({ appliedFields: [], suppressedFields: [] });
  });
});
