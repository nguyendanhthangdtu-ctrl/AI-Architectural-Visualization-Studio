import { describe, expect, it } from 'vitest';
import { createDefaultLocks, type Lock, type LockId } from '@avs/project-core';
import type { Timestamp, UserId } from '@avs/shared';
import { deriveProjectDNA, type NormalizedRequest, type StructuredIntelligence } from '@avs/ai-core';
import { compilePromptOutput } from './prompt-output-compiler.js';
import { CANONICAL_PROMPT_SECTION_ORDER } from './canonical-prompt-dna.js';

const now = '2026-09-04T00:00:00.000Z' as Timestamp;
const userId = 'u1' as UserId;

function locksWith(overrides: Partial<Record<LockId, boolean>> = {}): Lock[] {
  const base = createDefaultLocks({ analysisVersion: 'test:v1', setBy: userId, setAt: now });
  return base.map((lock) => (overrides[lock.id] !== undefined ? { ...lock, enabled: overrides[lock.id]! } : lock));
}

function buildStructuredIntelligence(): StructuredIntelligence {
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

function buildRequest(locks: Lock[] = locksWith()): NormalizedRequest {
  const structuredIntelligence = buildStructuredIntelligence();
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
    locks,
    references: [],
    instructions: [],
    conflicts: [],
  };
}

describe('compilePromptOutput — BUILD 11 orchestration (deliverables A-D)', () => {
  it('produces all four amendment deliverables: structured intelligence, EN prompt, VI prompt, bilingual', async () => {
    const output = await compilePromptOutput(buildRequest(), { analysisLanguage: 'en', outputLanguage: 'auto' });
    expect(output.promptIntelligence).toBeDefined();
    expect(output.masterPromptEn.length).toBeGreaterThan(0);
    expect(output.masterPromptVi.length).toBeGreaterThan(0);
    expect(output.bilingualPrompt).toContain('EN:');
    expect(output.bilingualPrompt).toContain('VI:');
  });

  it('produces a real, non-fabricated Vietnamese master prompt using known-vocabulary translation', async () => {
    const output = await compilePromptOutput(buildRequest(), { analysisLanguage: 'en', outputLanguage: 'auto' });
    // "golden hour" and "Modern Contemporary" are real closed-vocabulary translations (vi-glossary.ts).
    expect(output.masterPromptVi).toContain('giờ vàng');
    expect(output.masterPromptVi).toContain('hiện đại đương đại');
  });

  it('keeps "Real-life photography / Ảnh chụp thực tế" as the default first section', async () => {
    const output = await compilePromptOutput(buildRequest(), { analysisLanguage: 'en', outputLanguage: 'auto' });
    expect(output.canonicalPromptDNA.sections[0]?.key).toBe('realLifePhotography');
    expect(output.canonicalPromptDNA.sections[0]?.content.en).toContain('Real-life photography');
    expect(output.canonicalPromptDNA.sections[0]?.content.vi).toContain('ảnh chụp thực tế');
  });

  it('preserves the canonical section order exactly', async () => {
    const output = await compilePromptOutput(buildRequest(), { analysisLanguage: 'en', outputLanguage: 'auto' });
    expect(output.canonicalPromptDNA.sections.map((s) => s.key)).toEqual([...CANONICAL_PROMPT_SECTION_ORDER]);
  });

  it('notes camera preservation when Camera Lock is enabled (default) in both languages', async () => {
    const output = await compilePromptOutput(buildRequest(), { analysisLanguage: 'en', outputLanguage: 'auto' });
    const cameraSection = output.canonicalPromptDNA.sections.find((s) => s.key === 'cameraAndPhotographySystem')!;
    expect(cameraSection.content.en).toContain('preserve original camera');
    expect(cameraSection.content.vi).toContain('giữ nguyên góc máy gốc');
  });

  it('relaxes the technical/structural section when Architecture Lock is disabled, in both languages', async () => {
    const enabled = await compilePromptOutput(buildRequest(), { analysisLanguage: 'en', outputLanguage: 'auto' });
    const enabledSection = enabled.canonicalPromptDNA.sections.find((s) => s.key === 'technicalStructuralControl')!;
    expect(enabledSection.content.en).toContain('exact geometry');

    const disabled = await compilePromptOutput(buildRequest(locksWith({ architecture: false })), {
      analysisLanguage: 'en',
      outputLanguage: 'auto',
    });
    const disabledSection = disabled.canonicalPromptDNA.sections.find((s) => s.key === 'technicalStructuralControl')!;
    expect(disabledSection.content.en).not.toContain('exact geometry');
    expect(disabledSection.content.en).toContain('no hallucinated details'); // output-quality flags never relax
    expect(disabledSection.content.vi).toContain('không bịa đặt chi tiết');
  });

  it('carries a real userPreferenceContribution through to the structured intelligence', async () => {
    const contribution = { appliedFields: ['style'], suppressedFields: [] };
    const output = await compilePromptOutput(buildRequest(), {
      analysisLanguage: 'en',
      outputLanguage: 'auto',
      userPreferenceContribution: contribution,
    });
    expect(output.promptIntelligence.userPreferenceContribution).toEqual(contribution);
  });

  it('still returns the full docs/09 14-section CanonicalMasterPrompt via `compiled`, not replaced by the concise DNA', async () => {
    const output = await compilePromptOutput(buildRequest(), { analysisLanguage: 'en', outputLanguage: 'auto' });
    expect(Object.keys(output.compiled.sections)).toHaveLength(14);
    expect(output.compiled.sections.subject).toContain('A modern villa.');
  });
});
