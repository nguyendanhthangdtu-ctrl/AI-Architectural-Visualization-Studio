/**
 * Architecture module vocabulary — BUILD 04. Closed reference vocabularies
 * for the fields docs/05_AI_ANALYSIS_SPEC.md layer 2 (ARCHITECTURE) and layer
 * 9 (OBJECT) actually populate for the Architecture module, scoped to
 * exteriors as distinct from Interior's furniture/spatial-layout vocabulary
 * (dna.ts InteriorDNA — BUILD 05's module to specialize).
 *
 * This is reference data only — closed string-union vocabularies and a
 * static description — never an inference or analysis result. The Vision
 * Analysis Engine (BUILD 07) is what will actually populate an
 * ArchitectureDNA instance using this vocabulary; nothing here calls it or
 * simulates its output (CLAUDE.md rule 7).
 */

export type ArchitectureRoofType =
  'flat' | 'gable' | 'hip' | 'shed' | 'butterfly' | 'gambrel' | 'mansard' | 'green-roof' | 'other';

export type ArchitectureOpeningType = 'window' | 'door' | 'sliding-glass' | 'skylight' | 'louvre' | 'curtain-wall';

export type ArchitectureFacadeElement =
  'cladding' | 'cantilever' | 'balcony' | 'colonnade' | 'brise-soleil' | 'parapet' | 'plinth';

export type ArchitectureStairType = 'straight' | 'l-shaped' | 'u-shaped' | 'spiral' | 'floating' | 'exterior-ramp';

/**
 * Exterior/site object categories for docs/05 layer 9 (OBJECT), distinct
 * from InteriorDNA's furniture vocabulary — Architecture Lock (docs/03
 * ADR-001) governs the building itself; these are the *site* objects a
 * keep/edit/replace/add permission (ObjectPermission, project.ts) can target.
 */
export type ArchitectureObjectCategory =
  | 'landscaping'
  | 'vehicle'
  | 'entry-feature'
  | 'site-furniture'
  | 'water-feature'
  | 'boundary-fencing'
  | 'signage'
  | 'lighting-fixture-exterior';

export const ARCHITECTURE_ROOF_TYPES: readonly ArchitectureRoofType[] = [
  'flat',
  'gable',
  'hip',
  'shed',
  'butterfly',
  'gambrel',
  'mansard',
  'green-roof',
  'other',
];

export const ARCHITECTURE_OPENING_TYPES: readonly ArchitectureOpeningType[] = [
  'window',
  'door',
  'sliding-glass',
  'skylight',
  'louvre',
  'curtain-wall',
];

export const ARCHITECTURE_FACADE_ELEMENTS: readonly ArchitectureFacadeElement[] = [
  'cladding',
  'cantilever',
  'balcony',
  'colonnade',
  'brise-soleil',
  'parapet',
  'plinth',
];

export const ARCHITECTURE_STAIR_TYPES: readonly ArchitectureStairType[] = [
  'straight',
  'l-shaped',
  'u-shaped',
  'spiral',
  'floating',
  'exterior-ramp',
];

export const ARCHITECTURE_OBJECT_CATEGORIES: readonly ArchitectureObjectCategory[] = [
  'landscaping',
  'vehicle',
  'entry-feature',
  'site-furniture',
  'water-feature',
  'boundary-fencing',
  'signage',
  'lighting-fixture-exterior',
];

export interface ArchitectureModuleDescription {
  /** docs/05 layer 2 fields this module's analysis will populate. */
  analysisFocus: readonly string[];
  roofTypes: readonly ArchitectureRoofType[];
  openingTypes: readonly ArchitectureOpeningType[];
  facadeElements: readonly ArchitectureFacadeElement[];
  stairTypes: readonly ArchitectureStairType[];
  objectCategories: readonly ArchitectureObjectCategory[];
}

/** Static reference description — no analysis, no I/O, no randomness. */
export function describeArchitectureModule(): ArchitectureModuleDescription {
  return {
    analysisFocus: ['geometry', 'openings', 'roof', 'facade', 'floor plan', 'ceiling', 'stairs', 'proportions'],
    roofTypes: ARCHITECTURE_ROOF_TYPES,
    openingTypes: ARCHITECTURE_OPENING_TYPES,
    facadeElements: ARCHITECTURE_FACADE_ELEMENTS,
    stairTypes: ARCHITECTURE_STAIR_TYPES,
    objectCategories: ARCHITECTURE_OBJECT_CATEGORIES,
  };
}
