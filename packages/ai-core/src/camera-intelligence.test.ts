import { describe, expect, it } from 'vitest';
import type { CameraDNA } from '@avs/project-core';
import { buildCameraIntelligence } from './camera-intelligence.js';

function dna(overrides: Partial<CameraDNA> = {}): CameraDNA {
  return {
    height: 1.6,
    lens: null,
    fieldOfView: 60,
    perspective: 'eye level',
    eyeLevel: 'standing',
    projection: null,
    verticalCorrection: 'none',
    ...overrides,
  };
}

describe('buildCameraIntelligence', () => {
  it('reuses CameraDNA by composition rather than duplicating its fields', () => {
    const cameraDna = dna();
    const result = buildCameraIntelligence({ dna: cameraDna, cameraLockEnabled: true, isViewportSource: true });
    expect(result.dna).toBe(cameraDna);
  });

  it('classifies a wide-angle lens description', () => {
    const result = buildCameraIntelligence({ dna: dna({ lens: 'Wide-angle 24mm' }), cameraLockEnabled: false, isViewportSource: false });
    expect(result.lensCharacteristic).toBe('wide-angle');
  });

  it('classifies a telephoto lens description', () => {
    const result = buildCameraIntelligence({ dna: dna({ lens: 'Telephoto 85mm' }), cameraLockEnabled: false, isViewportSource: false });
    expect(result.lensCharacteristic).toBe('telephoto');
  });

  it('returns null lens characteristic when unclassifiable rather than guessing', () => {
    const result = buildCameraIntelligence({ dna: dna({ lens: 'some lens' }), cameraLockEnabled: false, isViewportSource: false });
    expect(result.lensCharacteristic).toBeNull();
  });

  it('classifies one/two/three-point perspective from the projection description', () => {
    expect(buildCameraIntelligence({ dna: dna({ projection: 'two-point perspective' }), cameraLockEnabled: false, isViewportSource: false }).perspectiveType).toBe('two-point');
    expect(buildCameraIntelligence({ dna: dna({ projection: 'three point' }), cameraLockEnabled: false, isViewportSource: false }).perspectiveType).toBe('three-point');
  });

  it('preserveOriginalCamera is true only when both viewport source AND Camera Lock are true', () => {
    expect(buildCameraIntelligence({ dna: dna(), cameraLockEnabled: true, isViewportSource: true }).preserveOriginalCamera).toBe(true);
    expect(buildCameraIntelligence({ dna: dna(), cameraLockEnabled: true, isViewportSource: false }).preserveOriginalCamera).toBe(false);
    expect(buildCameraIntelligence({ dna: dna(), cameraLockEnabled: false, isViewportSource: true }).preserveOriginalCamera).toBe(false);
  });

  it('never fabricates an illustrative camera system — stays null until something real supplies one', () => {
    const result = buildCameraIntelligence({ dna: dna(), cameraLockEnabled: true, isViewportSource: true });
    expect(result.illustrativeCameraSystem).toBeNull();
  });
});
