import { describe, expect, it } from 'vitest';
import { createDefaultLocks, createEmptyUserVisualPreferenceDNA, type Lock, type LockId } from '@avs/project-core';
import type { Timestamp, UserId } from '@avs/shared';
import { applyUserVisualPreference } from './user-preference-application.js';
import type { NormalizedRequest } from './reasoning-engine.js';

const now = '2026-09-04T00:00:00.000Z' as Timestamp;
const userId = 'u1' as UserId;

function locksWith(overrides: Partial<Record<LockId, boolean>>): Lock[] {
  const base = createDefaultLocks({ analysisVersion: 'test:v1', setBy: userId, setAt: now });
  return base.map((lock) => (overrides[lock.id] !== undefined ? { ...lock, enabled: overrides[lock.id]! } : lock));
}

function buildRequest(locks: Lock[]): NormalizedRequest {
  return {
    structuredIntelligence: { analysisVersion: 'v1', module: 'architecture', layers: {} as never },
    projectDNA: {
      architectureDNA: null,
      interiorDNA: null,
      cameraDNA: { height: 1.6, lens: null, fieldOfView: 60, perspective: null, eyeLevel: null, projection: null, verticalCorrection: null },
      materialDNA: { assignments: {} },
      lightingDNA: { direction: null, timeOfDay: 'midday', intensity: null, softness: null, colorTemperature: null, artificialLighting: [] },
      environmentDNA: { setting: null, sky: null, weather: null, context: null },
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
    locks,
    references: [],
    instructions: [],
    conflicts: [],
  };
}

describe('applyUserVisualPreference — precedence (docs/06 tier 6, lowest priority)', () => {
  it('applies a style preference when Style Lock is disabled (the default)', () => {
    const request = buildRequest(locksWith({}));
    const preference = { ...createEmptyUserVisualPreferenceDNA({ userId, updatedAt: now }), style: 'Japandi' };
    const result = applyUserVisualPreference(request, preference);
    expect(result.request.resolvedStyle).toBe('Japandi');
    expect(result.appliedFields).toContain('style');
  });

  it('never lets a style preference override an enabled Style Lock — suppressed and reported, not silently dropped', () => {
    const request = buildRequest(locksWith({ style: true }));
    const preference = { ...createEmptyUserVisualPreferenceDNA({ userId, updatedAt: now }), style: 'Japandi' };
    const result = applyUserVisualPreference(request, preference);
    expect(result.request.resolvedStyle).toBe('Modern Contemporary'); // unchanged
    expect(result.suppressedFields).toContainEqual(expect.objectContaining({ field: 'style' }));
  });

  it('never lets a camera preference override an enabled Camera Lock', () => {
    const request = buildRequest(locksWith({ camera: true }));
    const preference = { ...createEmptyUserVisualPreferenceDNA({ userId, updatedAt: now }), camera: { height: 2.5 } };
    const result = applyUserVisualPreference(request, preference);
    expect(result.request.projectDNA.cameraDNA.height).toBe(1.6); // unchanged
    expect(result.suppressedFields).toContainEqual(expect.objectContaining({ field: 'camera' }));
  });

  it('applies a camera preference when Camera Lock is disabled', () => {
    const request = buildRequest(locksWith({ camera: false }));
    const preference = { ...createEmptyUserVisualPreferenceDNA({ userId, updatedAt: now }), camera: { height: 2.5 } };
    const result = applyUserVisualPreference(request, preference);
    expect(result.request.projectDNA.cameraDNA.height).toBe(2.5);
    expect(result.appliedFields).toContain('camera');
  });

  it('never lets a material preference override an enabled Material Lock', () => {
    const request = buildRequest(locksWith({ material: true }));
    const preference = { ...createEmptyUserVisualPreferenceDNA({ userId, updatedAt: now }), material: 'polished marble' };
    const result = applyUserVisualPreference(request, preference);
    expect(result.suppressedFields).toContainEqual(expect.objectContaining({ field: 'material' }));
  });

  it('never lets a lighting preference override an enabled Lighting Lock', () => {
    const request = buildRequest(locksWith({ lighting: true }));
    const preference = { ...createEmptyUserVisualPreferenceDNA({ userId, updatedAt: now }), lighting: { timeOfDay: 'sunset' } };
    const result = applyUserVisualPreference(request, preference);
    expect(result.request.projectDNA.lightingDNA.timeOfDay).toBe('midday'); // unchanged
    expect(result.suppressedFields).toContainEqual(expect.objectContaining({ field: 'lighting' }));
  });

  it('applies a lighting preference when Lighting Lock is disabled', () => {
    const request = buildRequest(locksWith({ lighting: false }));
    const preference = { ...createEmptyUserVisualPreferenceDNA({ userId, updatedAt: now }), lighting: { timeOfDay: 'sunset' } };
    const result = applyUserVisualPreference(request, preference);
    expect(result.request.projectDNA.lightingDNA.timeOfDay).toBe('sunset');
  });

  it('has no architecture field to apply in the first place — UserVisualPreferenceDNA structurally cannot touch protected architecture', () => {
    const preference = createEmptyUserVisualPreferenceDNA({ userId, updatedAt: now });
    expect('architecture' in preference).toBe(false);
  });

  it('applying an all-empty preference changes nothing and suppresses nothing', () => {
    const request = buildRequest(locksWith({}));
    const preference = createEmptyUserVisualPreferenceDNA({ userId, updatedAt: now });
    const result = applyUserVisualPreference(request, preference);
    expect(result.appliedFields).toEqual([]);
    expect(result.suppressedFields).toEqual([]);
    expect(result.request).toEqual(request);
  });
});
