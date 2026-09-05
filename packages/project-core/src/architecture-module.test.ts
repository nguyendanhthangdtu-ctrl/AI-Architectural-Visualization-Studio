import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURE_FACADE_ELEMENTS,
  ARCHITECTURE_OBJECT_CATEGORIES,
  ARCHITECTURE_OPENING_TYPES,
  ARCHITECTURE_ROOF_TYPES,
  ARCHITECTURE_STAIR_TYPES,
  describeArchitectureModule,
} from './architecture-module.js';

describe('describeArchitectureModule', () => {
  it('is a pure static description — same result every call, no side effects', () => {
    expect(describeArchitectureModule()).toEqual(describeArchitectureModule());
  });

  it('exposes the docs/05 layer 2 analysis focus fields', () => {
    const description = describeArchitectureModule();
    expect(description.analysisFocus).toEqual([
      'geometry',
      'openings',
      'roof',
      'facade',
      'floor plan',
      'ceiling',
      'stairs',
      'proportions',
    ]);
  });

  it('exposes closed, non-empty vocabularies for every architecture field', () => {
    const description = describeArchitectureModule();
    expect(description.roofTypes).toBe(ARCHITECTURE_ROOF_TYPES);
    expect(description.openingTypes).toBe(ARCHITECTURE_OPENING_TYPES);
    expect(description.facadeElements).toBe(ARCHITECTURE_FACADE_ELEMENTS);
    expect(description.stairTypes).toBe(ARCHITECTURE_STAIR_TYPES);
    expect(description.objectCategories).toBe(ARCHITECTURE_OBJECT_CATEGORIES);
    for (const vocab of [
      ARCHITECTURE_ROOF_TYPES,
      ARCHITECTURE_OPENING_TYPES,
      ARCHITECTURE_FACADE_ELEMENTS,
      ARCHITECTURE_STAIR_TYPES,
      ARCHITECTURE_OBJECT_CATEGORIES,
    ]) {
      expect(vocab.length).toBeGreaterThan(0);
    }
  });

  it('keeps the exterior/site object vocabulary distinct from InteriorDNA furniture concerns', () => {
    expect(ARCHITECTURE_OBJECT_CATEGORIES).not.toContain('furniture');
    expect(ARCHITECTURE_OBJECT_CATEGORIES).toEqual(expect.arrayContaining(['landscaping', 'vehicle', 'entry-feature']));
  });
});
