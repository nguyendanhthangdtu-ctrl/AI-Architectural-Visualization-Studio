import { describe, expect, it } from 'vitest';
import { createDefaultLocks, type Lock, type LockId } from '@avs/project-core';
import type { Timestamp, UserId } from '@avs/shared';
import { deriveProjectDNA, type NormalizedRequest, type StructuredIntelligence } from '@avs/ai-core';
import { promptCompiler } from './compiler.js';

const now = '2026-09-04T00:00:00.000Z' as Timestamp;
const userId = 'u1' as UserId;

function locksWith(overrides: Partial<Record<LockId, boolean>> = {}): Lock[] {
  const base = createDefaultLocks({ analysisVersion: 'test:v1', setBy: userId, setAt: now });
  return base.map((lock) => (overrides[lock.id] !== undefined ? { ...lock, enabled: overrides[lock.id]! } : lock));
}

function buildStructuredIntelligence(overrides: { module?: 'architecture' | 'interior' } = {}): StructuredIntelligence {
  return {
    analysisVersion: 'test:v1',
    module: overrides.module ?? 'architecture',
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
        data: {
          leadingLines: 'strong',
          ruleOfThirds: 'centered',
          goldenRatio: '',
          symmetry: 'symmetric',
          balance: '',
          negativeSpace: '',
          hierarchy: '',
        },
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
      object: {
        confidence: 0.5,
        warnings: [],
        data: { objects: [{ label: 'chair', category: 'furniture', suggestedAction: 'keep' as const }] },
      },
      photography: {
        confidence: 0.6,
        warnings: [],
        data: { cameraSystemLook: 'full-frame', lensBehavior: 'sharp', exposure: 'balanced', dynamicRange: 'high', depth: 'deep', imperfections: '' },
      },
      realLifeLook: { confidence: 0.7, warnings: [], data: { description: 'Professional architectural photography.' } },
      constraints: { confidence: 0.9, warnings: [], data: { notedUncertainties: [] } },
    },
  };
}

function buildRequest(overrides: { module?: 'architecture' | 'interior'; locks?: Lock[] } = {}): NormalizedRequest {
  const structuredIntelligence = buildStructuredIntelligence(overrides.module ? { module: overrides.module } : {});
  return {
    structuredIntelligence,
    projectDNA: deriveProjectDNA(structuredIntelligence),
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
    locks: overrides.locks ?? locksWith(),
    references: [],
    instructions: [],
    conflicts: [],
  };
}

describe('promptCompiler.compile — real, deterministic composition from NormalizedRequest', () => {
  it('compiles all 14 docs/09 sections as non-empty real text for a complete request', async () => {
    const result = await promptCompiler.compile(buildRequest());
    expect(result.compilerVersion).toContain('prompt-compiler');
    expect(result.normalizedRequestSnapshot).toBeDefined();
    for (const key of Object.keys(result.sections) as (keyof typeof result.sections)[]) {
      expect(result.sections[key]).not.toBe('');
    }
  });

  it('reflects real structured data in the subject/style/material sections, not placeholders', async () => {
    const result = await promptCompiler.compile(buildRequest());
    expect(result.sections.subject).toContain('A modern villa.');
    expect(result.sections.style).toBe('Modern Contemporary');
    expect(result.sections.material).toContain('concrete');
  });

  it('compiles the architecture section from architectureDNA for the architecture module', async () => {
    const result = await promptCompiler.compile(buildRequest({ module: 'architecture' }));
    expect(result.sections.architecture).toContain('boxy');
    expect(result.sections.architecture).toContain('Roof: flat');
  });

  it('compiles the architecture-slot section from interiorDNA for the interior module, never leaving it empty', async () => {
    const result = await promptCompiler.compile(buildRequest({ module: 'interior' }));
    expect(result.sections.architecture).not.toBe('');
    expect(result.sections.architecture).toContain('Spatial layout');
  });

  it('notes Camera Lock preservation in the camera section when the lock is enabled (default)', async () => {
    const result = await promptCompiler.compile(buildRequest());
    expect(result.sections.camera).toContain('Camera Lock enabled — preserve the original camera exactly.');
  });

  it('omits the Camera Lock note when Camera Lock is disabled', async () => {
    const result = await promptCompiler.compile(buildRequest({ locks: locksWith({ camera: false }) }));
    expect(result.sections.camera).not.toContain('Camera Lock enabled');
    expect(result.sections.camera).toContain('wide-angle');
  });

  it('relaxes the constraints section when Architecture Lock is disabled, matching BUILD 08 lock precedence', async () => {
    const enabled = await promptCompiler.compile(buildRequest());
    expect(enabled.sections.constraints).toContain('Exact geometry — no deviation.');

    const disabled = await promptCompiler.compile(buildRequest({ locks: locksWith({ architecture: false }) }));
    expect(disabled.sections.constraints).not.toContain('Exact geometry — no deviation.');
    expect(disabled.sections.constraints).toContain('No hallucinated details.'); // output-quality flags never relax
    expect(disabled.sections.constraints).toContain('Photorealistic.');
  });

  it('reports "no reference images supplied" honestly rather than fabricating reference content', async () => {
    const result = await promptCompiler.compile(buildRequest());
    expect(result.sections.reference).toBe('No reference images supplied.');
  });

  it('includes real scenario values in the output section', async () => {
    const result = await promptCompiler.compile(buildRequest());
    expect(result.sections.output).toContain('2:3');
    expect(result.sections.output).toContain('2K');
    expect(result.sections.output).toContain('4K');
  });
});
