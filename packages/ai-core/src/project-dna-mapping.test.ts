import { describe, expect, it } from 'vitest';
import { deriveProjectDNA } from './project-dna-mapping.js';
import type { StructuredIntelligence } from './vision-analysis.js';

function buildStructuredIntelligence(module: 'architecture' | 'interior'): StructuredIntelligence {
  return {
    analysisVersion: 'test:v1',
    module,
    layers: {
      subject: { confidence: 0.9, warnings: [], data: { type: 'building', description: 'a villa' } },
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
          lens: 'wide',
          fieldOfViewDegrees: 60,
          perspective: 'eye level',
          eyeLevel: 'standing',
          projection: 'perspective',
          verticalCorrection: 'none',
        },
      },
      composition: {
        confidence: 0.7,
        warnings: [],
        data: {
          leadingLines: '',
          ruleOfThirds: '',
          goldenRatio: '',
          symmetry: '',
          balance: '',
          negativeSpace: '',
          hierarchy: '',
        },
      },
      material: {
        confidence: 0.6,
        warnings: [],
        data: {
          materials: [{ surface: 'wall', type: 'concrete', finish: 'smooth', roughness: 'low', reflectance: 'low' }],
        },
      },
      lighting: {
        confidence: 0.5,
        warnings: [],
        data: {
          direction: 'front',
          timeOfDay: 'midday',
          intensity: 'high',
          softness: 'hard',
          shadows: 'sharp',
          colorTemperature: 'neutral',
          artificialLighting: [],
        },
      },
      environment: {
        confidence: 0.6,
        warnings: [],
        data: { setting: 'urban', sky: 'clear', weather: 'sunny', context: 'street' },
      },
      object: {
        confidence: 0.5,
        warnings: [],
        data: { objects: [{ label: 'tree', category: 'landscaping', suggestedAction: 'keep' }] },
      },
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

describe('deriveProjectDNA', () => {
  it('populates architectureDNA and leaves interiorDNA null for the architecture module', () => {
    const dna = deriveProjectDNA(buildStructuredIntelligence('architecture'));
    expect(dna.architectureDNA).not.toBeNull();
    expect(dna.architectureDNA?.roof).toEqual({ description: 'flat' });
    expect(dna.interiorDNA).toBeNull();
  });

  it('populates interiorDNA and leaves architectureDNA null for the interior module', () => {
    const dna = deriveProjectDNA(buildStructuredIntelligence('interior'));
    expect(dna.interiorDNA).not.toBeNull();
    expect(dna.architectureDNA).toBeNull();
  });

  it('always populates camera/material/lighting/environment DNA regardless of module', () => {
    const dna = deriveProjectDNA(buildStructuredIntelligence('interior'));
    expect(dna.cameraDNA.height).toBe(1.6);
    expect(dna.cameraDNA.eyeLevel).toBe('standing'); // qualitative string, not a number
    expect(dna.materialDNA.assignments.wall).toEqual({
      type: 'concrete',
      finish: 'smooth',
      roughness: 'low',
      reflectance: 'low',
    });
    expect(dna.lightingDNA.colorTemperature).toBe('neutral');
    expect(dna.environmentDNA.setting).toBe('urban');
  });

  it('never populates referenceDNA — that is Reference Intelligence (BUILD 10) territory', () => {
    const dna = deriveProjectDNA(buildStructuredIntelligence('architecture'));
    expect(dna.referenceDNA).toBeNull();
  });

  it('is a pure function — same input produces an equal (not necessarily identical) result', () => {
    const si = buildStructuredIntelligence('architecture');
    expect(deriveProjectDNA(si)).toEqual(deriveProjectDNA(si));
  });
});
