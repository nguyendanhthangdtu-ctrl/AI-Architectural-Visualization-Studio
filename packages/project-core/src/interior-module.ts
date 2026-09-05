/**
 * Interior module vocabulary — BUILD 05. Closed reference vocabularies for
 * the fields docs/05_AI_ANALYSIS_SPEC.md layer 2 (ARCHITECTURE, applied to
 * interior spatial/surface fields) and layer 9 (OBJECT) actually populate
 * for the Interior module, distinct from Architecture's exterior/site
 * vocabulary (architecture-module.ts — BUILD 04).
 *
 * This is reference data only — closed string-union vocabularies and a
 * static description — never an inference or analysis result. The Vision
 * Analysis Engine (BUILD 07) is what will actually populate an InteriorDNA
 * instance using this vocabulary; nothing here calls it or simulates its
 * output (CLAUDE.md rule 7).
 */

export type InteriorSpatialLayoutType = 'open-plan' | 'partitioned' | 'split-level' | 'loft' | 'galley' | 'l-shaped';

export type InteriorWallTreatment =
  'paint' | 'wallpaper' | 'paneling' | 'exposed-brick' | 'tile' | 'stone-cladding' | 'wood-slat';

export type InteriorFloorFinish =
  'hardwood' | 'engineered-wood' | 'tile' | 'polished-concrete' | 'natural-stone' | 'carpet' | 'vinyl' | 'terrazzo';

export type InteriorCeilingTreatment =
  'flat-painted' | 'coffered' | 'exposed-beam' | 'suspended' | 'cove' | 'skylight-integrated';

/**
 * Furniture/decor object categories for docs/05 layer 9 (OBJECT), distinct
 * from ArchitectureDNA's site-object vocabulary — Material Lock (docs/03
 * ADR-001) governs interior surface finishes; these are the *furnishing*
 * objects a keep/edit/replace/add permission (ObjectPermission, project.ts)
 * can target.
 */
export type InteriorObjectCategory =
  | 'seating'
  | 'table'
  | 'storage'
  | 'bedding'
  | 'lighting-fixture-interior'
  | 'rug-textile'
  | 'decor-accessory'
  | 'plant';

export const INTERIOR_SPATIAL_LAYOUT_TYPES: readonly InteriorSpatialLayoutType[] = [
  'open-plan',
  'partitioned',
  'split-level',
  'loft',
  'galley',
  'l-shaped',
];

export const INTERIOR_WALL_TREATMENTS: readonly InteriorWallTreatment[] = [
  'paint',
  'wallpaper',
  'paneling',
  'exposed-brick',
  'tile',
  'stone-cladding',
  'wood-slat',
];

export const INTERIOR_FLOOR_FINISHES: readonly InteriorFloorFinish[] = [
  'hardwood',
  'engineered-wood',
  'tile',
  'polished-concrete',
  'natural-stone',
  'carpet',
  'vinyl',
  'terrazzo',
];

export const INTERIOR_CEILING_TREATMENTS: readonly InteriorCeilingTreatment[] = [
  'flat-painted',
  'coffered',
  'exposed-beam',
  'suspended',
  'cove',
  'skylight-integrated',
];

export const INTERIOR_OBJECT_CATEGORIES: readonly InteriorObjectCategory[] = [
  'seating',
  'table',
  'storage',
  'bedding',
  'lighting-fixture-interior',
  'rug-textile',
  'decor-accessory',
  'plant',
];

export interface InteriorModuleDescription {
  /** docs/04 InteriorDNA fields this module's analysis will populate. */
  analysisFocus: readonly string[];
  spatialLayoutTypes: readonly InteriorSpatialLayoutType[];
  wallTreatments: readonly InteriorWallTreatment[];
  floorFinishes: readonly InteriorFloorFinish[];
  ceilingTreatments: readonly InteriorCeilingTreatment[];
  objectCategories: readonly InteriorObjectCategory[];
}

/** Static reference description — no analysis, no I/O, no randomness. */
export function describeInteriorModule(): InteriorModuleDescription {
  return {
    analysisFocus: ['spatial layout', 'walls', 'floor', 'ceiling', 'furniture layout'],
    spatialLayoutTypes: INTERIOR_SPATIAL_LAYOUT_TYPES,
    wallTreatments: INTERIOR_WALL_TREATMENTS,
    floorFinishes: INTERIOR_FLOOR_FINISHES,
    ceilingTreatments: INTERIOR_CEILING_TREATMENTS,
    objectCategories: INTERIOR_OBJECT_CATEGORIES,
  };
}
