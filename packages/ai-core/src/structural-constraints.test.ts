import { describe, expect, it } from 'vitest';
import { deriveStructuralConstraints, DEFAULT_STRUCTURAL_CONSTRAINTS } from './structural-constraints.js';

describe('deriveStructuralConstraints', () => {
  it('preserves every canonical principle when Architecture Lock is enabled', () => {
    const result = deriveStructuralConstraints({ architectureLockEnabled: true });
    expect(result).toEqual(DEFAULT_STRUCTURAL_CONSTRAINTS);
    expect(result.strictlyAdhereToReferenceSketch).toBe(true);
    expect(result.preserveStructuralIntegrity).toBe(true);
    expect(result.preserveExactGeometry).toBe(true);
    expect(result.noHallucinatedDetails).toBe(true);
    expect(result.exactLineArtTranslation).toBe(true);
    expect(result.photorealistic).toBe(true);
    expect(result.targetResolution).toBe('8K/Ultra');
  });

  it('relaxes only the geometric-fidelity flags when Architecture Lock is disabled', () => {
    const result = deriveStructuralConstraints({ architectureLockEnabled: false });
    expect(result.strictlyAdhereToReferenceSketch).toBe(false);
    expect(result.preserveStructuralIntegrity).toBe(false);
    expect(result.preserveExactGeometry).toBe(false);
    expect(result.exactLineArtTranslation).toBe(false);
  });

  it('keeps output-quality goals true even with Architecture Lock disabled — those are not source-fidelity concerns', () => {
    const result = deriveStructuralConstraints({ architectureLockEnabled: false });
    expect(result.noHallucinatedDetails).toBe(true);
    expect(result.photorealistic).toBe(true);
  });

  it('accepts a real target resolution from the shared docs/07 vocabulary', () => {
    const result = deriveStructuralConstraints({ architectureLockEnabled: true, targetResolution: '4K' });
    expect(result.targetResolution).toBe('4K');
  });
});
