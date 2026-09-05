import { describe, expect, it } from 'vitest';
import { createDefaultLocks, type Lock, type LockId } from '@avs/project-core';
import type { Timestamp, UserId } from '@avs/shared';
import { reasoningEngine } from './reasoning-engine.js';
import type { NormalizedScenario } from './scenario.js';
import type { ExtractedVisualLanguage } from './reference-intelligence.js';
import type { StructuredIntelligence } from './vision-analysis.js';

const now = '2026-09-04T00:00:00.000Z' as Timestamp;
const userId = 'u1' as UserId;

function locksWith(overrides: Partial<Record<LockId, boolean>>): Lock[] {
  const base = createDefaultLocks({ analysisVersion: 'test:v1', setBy: userId, setAt: now });
  return base.map((lock) => (overrides[lock.id] !== undefined ? { ...lock, enabled: overrides[lock.id]! } : lock));
}

function buildScenario(overrides: Partial<NormalizedScenario> = {}): NormalizedScenario {
  return {
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
    ...overrides,
  };
}

function buildStructuredIntelligence(
  overrides: { architectureConfidence?: number; style?: string } = {},
): StructuredIntelligence {
  return {
    analysisVersion: 'test:v1',
    module: 'architecture',
    layers: {
      subject: { confidence: 0.9, warnings: [], data: { type: 'building', description: 'a villa' } },
      architecture: {
        confidence: overrides.architectureConfidence ?? 0.8,
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
      style: {
        confidence: 0.7,
        warnings: [],
        data: { style: overrides.style ?? 'Modern Contemporary', influences: [] },
      },
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

function reference(purpose: ExtractedVisualLanguage['purpose']): ExtractedVisualLanguage {
  return { purpose, weight: 1, fields: {} };
}

describe('reasoningEngine.resolve — lock-set validation (tier 1 safety)', () => {
  it('rejects a lock set missing a required lock id', async () => {
    const locks = locksWith({}).filter((l) => l.id !== 'camera');
    await expect(
      reasoningEngine.resolve({
        structuredIntelligence: buildStructuredIntelligence(),
        locks,
        scenario: buildScenario(),
        references: [],
        instructions: [],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_LOCK_SET' });
  });

  it('rejects a lock whose tier does not match the fixed docs/03 ADR-001 assignment', async () => {
    const locks = locksWith({}).map((l) => (l.id === 'style' ? { ...l, tier: 'source-fidelity' as const } : l));
    await expect(
      reasoningEngine.resolve({
        structuredIntelligence: buildStructuredIntelligence(),
        locks,
        scenario: buildScenario(),
        references: [],
        instructions: [],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_LOCK_SET' });
  });
});

describe('reasoningEngine.resolve — Tier A (source-fidelity): Architecture', () => {
  it('preserves architecture with no conflict noise when the lock is enabled and confidence is fine', async () => {
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence(),
      locks: locksWith({}),
      scenario: buildScenario(),
      references: [],
      instructions: [],
    });
    expect(result.conflicts.filter((c) => c.field === 'architecture')).toHaveLength(0);
    expect(result.projectDNA.architectureDNA?.roof).toEqual({ description: 'flat' });
  });

  it('surfaces a warning — never silently — when architecture confidence is low, even though the lock still wins', async () => {
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence({ architectureConfidence: 0.2 }),
      locks: locksWith({}),
      scenario: buildScenario(),
      references: [],
      instructions: [],
    });
    const conflict = result.conflicts.find((c) => c.field === 'architecture');
    expect(conflict?.severity).toBe('warning');
    expect(conflict?.resolution).toMatch(/preserving the low-confidence observation/);
  });

  it('notes (info) when Architecture Lock is explicitly disabled', async () => {
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence(),
      locks: locksWith({ architecture: false }),
      scenario: buildScenario(),
      references: [],
      instructions: [],
    });
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({ field: 'architecture', severity: 'info', reason: expect.stringContaining('disabled') }),
    );
  });
});

describe('reasoningEngine.resolve — Tier A: Camera', () => {
  it('forces cameraMode back to "Preserve Original" and records a warning when Camera Lock conflicts with the scenario', async () => {
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence(),
      locks: locksWith({}),
      scenario: buildScenario({ cameraMode: 'Wide' }),
      references: [],
      instructions: [],
    });
    expect(result.scenario.cameraMode).toBe('Preserve Original');
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({ field: 'camera', severity: 'warning', resolution: expect.stringContaining('ignored') }),
    );
  });

  it('suppresses a camera-purpose reference and records the conflict when Camera Lock is enabled', async () => {
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence(),
      locks: locksWith({}),
      scenario: buildScenario(),
      references: [reference('camera')],
      instructions: [],
    });
    expect(result.conflicts).toContainEqual(expect.objectContaining({ field: 'camera', severity: 'warning' }));
  });

  it('lets scenario cameraMode through unchanged when Camera Lock is disabled', async () => {
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence(),
      locks: locksWith({ camera: false }),
      scenario: buildScenario({ cameraMode: 'Wide' }),
      references: [],
      instructions: [],
    });
    expect(result.scenario.cameraMode).toBe('Wide');
  });
});

describe('reasoningEngine.resolve — Tier A: Material', () => {
  it('records a warning when a material-purpose reference conflicts with an enabled Material Lock', async () => {
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence(),
      locks: locksWith({}),
      scenario: buildScenario(),
      references: [reference('material')],
      instructions: [],
    });
    expect(result.conflicts).toContainEqual(expect.objectContaining({ field: 'material', severity: 'warning' }));
  });

  it('never outranks a Tier A lock with a same-request Tier B lock — style-purpose references do not trip Material Lock', async () => {
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence(),
      locks: locksWith({}),
      scenario: buildScenario(),
      references: [reference('style')],
      instructions: [],
    });
    expect(result.conflicts.filter((c) => c.field === 'material')).toHaveLength(0);
  });
});

describe('reasoningEngine.resolve — Tier B (output-stability): Style', () => {
  it('is free to reflect the freshly observed style when Style Lock is disabled (the default)', async () => {
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence({ style: 'Japandi' }),
      locks: locksWith({}),
      scenario: buildScenario(),
      references: [],
      instructions: [],
    });
    expect(result.resolvedStyle).toBe('Japandi');
  });

  it('pins to the previously accepted style when enabled and a pin is supplied, noting the divergence', async () => {
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence({ style: 'Japandi' }),
      locks: locksWith({ style: true }),
      scenario: buildScenario(),
      references: [],
      instructions: [],
      pinnedOutputStability: { style: 'Modern Contemporary' },
    });
    expect(result.resolvedStyle).toBe('Modern Contemporary');
    expect(result.conflicts).toContainEqual(expect.objectContaining({ field: 'style', severity: 'info' }));
  });

  it('falls back to the fresh observation and warns when enabled but nothing was supplied to pin to', async () => {
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence({ style: 'Japandi' }),
      locks: locksWith({ style: true }),
      scenario: buildScenario(),
      references: [],
      instructions: [],
    });
    expect(result.resolvedStyle).toBe('Japandi');
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        field: 'style',
        severity: 'warning',
        resolution: expect.stringContaining('could not actually be honored'),
      }),
    );
  });
});

describe('reasoningEngine.resolve — Tier B: Lighting', () => {
  it('lets an unlocked scenario lighting choice outrank the source observation (tier 4 > tier 3)', async () => {
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence(),
      locks: locksWith({}),
      scenario: buildScenario({ lighting: 'Golden Hour' }),
      references: [],
      instructions: [],
    });
    expect(result.projectDNA.lightingDNA.timeOfDay).toBe('Golden Hour');
    expect(result.conflicts).toContainEqual(expect.objectContaining({ field: 'lighting', severity: 'info' }));
  });

  it('applies the pinned lighting values over the fresh observation when Lighting Lock is enabled and pinned', async () => {
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence(),
      locks: locksWith({ lighting: true }),
      scenario: buildScenario({ lighting: 'Golden Hour' }),
      references: [],
      instructions: [],
      pinnedOutputStability: { lightingDNA: { timeOfDay: 'Blue Hour' } },
    });
    expect(result.projectDNA.lightingDNA.timeOfDay).toBe('Blue Hour');
  });

  it('falls back to fresh observation and warns when Lighting Lock is enabled but nothing was supplied to pin to', async () => {
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence(),
      locks: locksWith({ lighting: true }),
      scenario: buildScenario(),
      references: [],
      instructions: [],
    });
    expect(result.projectDNA.lightingDNA.timeOfDay).toBe('midday'); // the source-observed value
    expect(result.conflicts).toContainEqual(expect.objectContaining({ field: 'lighting', severity: 'warning' }));
  });
});

describe('reasoningEngine.resolve — determinism and pass-through', () => {
  it('is deterministic — identical input produces an equal output', async () => {
    const input = {
      structuredIntelligence: buildStructuredIntelligence(),
      locks: locksWith({}),
      scenario: buildScenario(),
      references: [reference('style')],
      instructions: ['make it feel warmer'],
    };
    const [a, b] = await Promise.all([reasoningEngine.resolve(input), reasoningEngine.resolve(input)]);
    expect(a).toEqual(b);
  });

  it('passes locks, references, and instructions through unchanged', async () => {
    const locks = locksWith({});
    const references = [reference('style'), reference('composition')];
    const instructions = ['make it feel warmer'];
    const result = await reasoningEngine.resolve({
      structuredIntelligence: buildStructuredIntelligence(),
      locks,
      scenario: buildScenario(),
      references,
      instructions,
    });
    expect(result.locks).toEqual(locks);
    expect(result.references).toEqual(references);
    expect(result.instructions).toEqual(instructions);
  });
});
