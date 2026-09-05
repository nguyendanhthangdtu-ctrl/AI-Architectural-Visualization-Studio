import { describe, expect, it } from 'vitest';
import {
  INTERIOR_CEILING_TREATMENTS,
  INTERIOR_FLOOR_FINISHES,
  INTERIOR_OBJECT_CATEGORIES,
  INTERIOR_SPATIAL_LAYOUT_TYPES,
  INTERIOR_WALL_TREATMENTS,
  describeInteriorModule,
} from './interior-module.js';
import { ARCHITECTURE_OBJECT_CATEGORIES } from './architecture-module.js';

describe('describeInteriorModule', () => {
  it('is a pure static description — same result every call, no side effects', () => {
    expect(describeInteriorModule()).toEqual(describeInteriorModule());
  });

  it('exposes the InteriorDNA analysis focus fields (docs/04 Data Model)', () => {
    const description = describeInteriorModule();
    expect(description.analysisFocus).toEqual(['spatial layout', 'walls', 'floor', 'ceiling', 'furniture layout']);
  });

  it('exposes closed, non-empty vocabularies for every interior field', () => {
    const description = describeInteriorModule();
    expect(description.spatialLayoutTypes).toBe(INTERIOR_SPATIAL_LAYOUT_TYPES);
    expect(description.wallTreatments).toBe(INTERIOR_WALL_TREATMENTS);
    expect(description.floorFinishes).toBe(INTERIOR_FLOOR_FINISHES);
    expect(description.ceilingTreatments).toBe(INTERIOR_CEILING_TREATMENTS);
    expect(description.objectCategories).toBe(INTERIOR_OBJECT_CATEGORIES);
    for (const vocab of [
      INTERIOR_SPATIAL_LAYOUT_TYPES,
      INTERIOR_WALL_TREATMENTS,
      INTERIOR_FLOOR_FINISHES,
      INTERIOR_CEILING_TREATMENTS,
      INTERIOR_OBJECT_CATEGORIES,
    ]) {
      expect(vocab.length).toBeGreaterThan(0);
    }
  });

  it('keeps the furniture/decor object vocabulary distinct from ArchitectureDNA site-object concerns', () => {
    for (const category of INTERIOR_OBJECT_CATEGORIES) {
      expect(ARCHITECTURE_OBJECT_CATEGORIES).not.toContain(category);
    }
    expect(INTERIOR_OBJECT_CATEGORIES).toEqual(expect.arrayContaining(['seating', 'table', 'storage']));
  });
});
