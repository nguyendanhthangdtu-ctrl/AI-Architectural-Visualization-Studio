import { describe, expect, it } from 'vitest';
import { createDefaultLocks, type Lock, type LockId } from '@avs/project-core';
import type { Timestamp, UserId } from '@avs/shared';
import { reasoningEngine } from './reasoning-engine.js';
import { resolveView } from './view.js';
import type { NormalizedScenario } from './scenario.js';
import type { StructuredIntelligence } from './vision-analysis.js';

const now = '2026-09-04T00:00:00.000Z' as Timestamp;
const userId = 'u1' as UserId;

function locksWith(overrides: Partial<Record<LockId, boolean>> = {}): Lock[] {
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

function buildStructuredIntelligence(): StructuredIntelligence {
  return {
    analysisVersion: 'test:v1',
    module: 'architecture',
    layers: {
      subject: { confidence: 0.9, warnings: [], data: { type: 'building', description: 'a villa' } },
      architecture: {
        confidence: 0.8,
        warnings: [],
        data: { geometry: 'boxy', openings: 'glazing', roof: 'flat', facade: 'cladding', floorPlan: 'open', ceiling: 'flat', stairs: 'none', proportions: 'balanced' },
      },
      style: { confidence: 0.7, warnings: [], data: { style: 'Modern Contemporary', influences: [] } },
      camera: {
        confidence: 0.6,
        warnings: [],
        data: { heightMeters: 1.6, lens: 'wide', fieldOfViewDegrees: 60, perspective: 'eye level', eyeLevel: 'standing', projection: 'two-point perspective', verticalCorrection: 'none' },
      },
      composition: { confidence: 0.7, warnings: [], data: { leadingLines: '', ruleOfThirds: '', goldenRatio: '', symmetry: '', balance: '', negativeSpace: '', hierarchy: '' } },
      material: { confidence: 0.6, warnings: [], data: { materials: [{ surface: 'wall', type: 'concrete', finish: 'smooth', roughness: 'low', reflectance: 'low' }] } },
      lighting: { confidence: 0.5, warnings: [], data: { direction: 'front', timeOfDay: 'midday', intensity: 'high', softness: 'hard', shadows: 'sharp', colorTemperature: 'neutral', artificialLighting: [] } },
      environment: { confidence: 0.6, warnings: [], data: { setting: 'urban', sky: 'clear', weather: 'sunny', context: 'street' } },
      object: { confidence: 0.5, warnings: [], data: { objects: [] } },
      photography: { confidence: 0.6, warnings: [], data: { cameraSystemLook: '', lensBehavior: '', exposure: '', dynamicRange: '', depth: '', imperfections: '' } },
      realLifeLook: { confidence: 0.7, warnings: [], data: { description: 'professional' } },
      constraints: { confidence: 0.9, warnings: [], data: { notedUncertainties: [] } },
    },
  };
}

async function buildBaseRequest(locks = locksWith()) {
  return reasoningEngine.resolve({
    structuredIntelligence: buildStructuredIntelligence(),
    locks,
    scenario: buildScenario(),
    references: [],
    instructions: [],
  });
}

describe('resolveView — Sync View (docs/13: change camera, preserve everything else and locked attributes)', () => {
  it('applies a real camera proposal and opens only the camera lock for this request', async () => {
    const base = await buildBaseRequest();
    const { request } = resolveView({ baseRequest: base, mode: 'sync', proposal: { camera: { perspective: 'bird’s eye' } } });
    expect(request.projectDNA.cameraDNA.perspective).toBe('bird’s eye');
    expect(request.locks.find((l) => l.id === 'camera')?.enabled).toBe(false);
    expect(request.locks.find((l) => l.id === 'architecture')?.enabled).toBe(true);
    expect(request.locks.find((l) => l.id === 'material')?.enabled).toBe(true);
  });

  it('preserves architecture/material/lighting/style DNA exactly', async () => {
    const base = await buildBaseRequest();
    const { request } = resolveView({ baseRequest: base, mode: 'sync', proposal: { camera: { height: 5 } } });
    expect(request.projectDNA.architectureDNA).toEqual(base.projectDNA.architectureDNA);
    expect(request.projectDNA.materialDNA).toEqual(base.projectDNA.materialDNA);
    expect(request.projectDNA.lightingDNA).toEqual(base.projectDNA.lightingDNA);
    expect(request.resolvedStyle).toBe(base.resolvedStyle);
  });

  it('structurally ignores material/lighting/style proposals — never silently applies, never silently drops without a record', async () => {
    const base = await buildBaseRequest();
    const { request, ignoredProposals, conflicts } = resolveView({
      baseRequest: base,
      mode: 'sync',
      proposal: { material: { assignments: { wall: { type: 'wood', finish: 'matte', roughness: 'high', reflectance: 'low' } } }, style: 'Industrial' },
    });
    expect(ignoredProposals.sort()).toEqual(['material', 'style']);
    expect(request.projectDNA.materialDNA).toEqual(base.projectDNA.materialDNA);
    expect(request.resolvedStyle).toBe(base.resolvedStyle);
    expect(conflicts.some((c) => c.field === 'material' && c.severity === 'warning')).toBe(true);
    expect(conflicts.some((c) => c.field === 'style' && c.severity === 'warning')).toBe(true);
  });

  it('leaves the request unchanged (including locks) when no camera proposal is given', async () => {
    const base = await buildBaseRequest();
    const { request } = resolveView({ baseRequest: base, mode: 'sync', proposal: {} });
    expect(request.projectDNA.cameraDNA).toEqual(base.projectDNA.cameraDNA);
    expect(request.locks).toEqual(base.locks);
  });
});

describe('resolveView — Creative View (docs/13: alternative camera/composition, preserve Architecture DNA)', () => {
  it('applies camera, material, lighting, and style proposals together', async () => {
    const base = await buildBaseRequest();
    const { request } = resolveView({
      baseRequest: base,
      mode: 'creative',
      proposal: {
        camera: { perspective: 'low angle' },
        material: { assignments: { wall: { type: 'wood', finish: 'matte', roughness: 'high', reflectance: 'low' } } },
        lighting: { timeOfDay: 'sunset' },
        style: 'Industrial',
      },
    });
    expect(request.projectDNA.cameraDNA.perspective).toBe('low angle');
    expect(request.projectDNA.materialDNA.assignments['wall']).toEqual({ type: 'wood', finish: 'matte', roughness: 'high', reflectance: 'low' });
    expect(request.projectDNA.lightingDNA.timeOfDay).toBe('sunset');
    expect(request.resolvedStyle).toBe('Industrial');
  });

  it('never changes architecture DNA — no field exists on ViewProposal to do so', async () => {
    const base = await buildBaseRequest();
    const { request } = resolveView({
      baseRequest: base,
      mode: 'creative',
      proposal: { camera: { height: 10 }, style: 'Brutalist' },
    });
    expect(request.projectDNA.architectureDNA).toEqual(base.projectDNA.architectureDNA);
  });

  it('opens only the locks for fields actually proposed, leaving architecture (and untouched fields) as-is', async () => {
    const base = await buildBaseRequest();
    const { request } = resolveView({ baseRequest: base, mode: 'creative', proposal: { style: 'Industrial' } });
    expect(request.locks.find((l) => l.id === 'style')?.enabled).toBe(false);
    expect(request.locks.find((l) => l.id === 'camera')?.enabled).toBe(true); // untouched — no camera proposal given
    expect(request.locks.find((l) => l.id === 'architecture')?.enabled).toBe(true);
  });

  it('merges a material assignment patch rather than replacing the whole map', async () => {
    const base = await buildBaseRequest();
    const { request } = resolveView({
      baseRequest: base,
      mode: 'creative',
      proposal: { material: { assignments: { floor: { type: 'marble', finish: 'polished', roughness: 'low', reflectance: 'high' } } } },
    });
    expect(request.projectDNA.materialDNA.assignments['wall']).toEqual(base.projectDNA.materialDNA.assignments['wall']); // original entry kept
    expect(request.projectDNA.materialDNA.assignments['floor']).toEqual({ type: 'marble', finish: 'polished', roughness: 'low', reflectance: 'high' });
  });

  it('leaves the request unchanged when no proposal fields are given', async () => {
    const base = await buildBaseRequest();
    const { request, ignoredProposals } = resolveView({ baseRequest: base, mode: 'creative', proposal: {} });
    expect(request.projectDNA).toEqual(base.projectDNA);
    expect(request.resolvedStyle).toBe(base.resolvedStyle);
    expect(request.locks).toEqual(base.locks);
    expect(ignoredProposals).toEqual([]);
  });
});
