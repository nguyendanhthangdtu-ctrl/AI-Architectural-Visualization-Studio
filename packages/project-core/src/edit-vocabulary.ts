/**
 * Advanced Editor category vocabulary — docs/12_EDITOR_SPEC.md capabilities,
 * as a closed list (BUILD 14). Purely a structured label for UI selection
 * and provenance (docs/12 "each edit must declare... intended change") — the
 * actual edit instruction is always the freeform `intendedChange` text; the
 * category never changes which adapter method or endpoint is called.
 * "Select / Mask / Brush" (docs/12) is a UI *tool*, not an edit category —
 * intentionally not listed here (see `EditRecord.maskAssetId`, repositories.ts).
 */
export const EDIT_CATEGORIES = [
  'inpaint-outpaint',
  'material-replacement',
  'furniture-object-replacement',
  'people-vegetation-vehicles-decor-environment',
  'lighting-atmosphere',
  'other',
] as const;

export type EditCategory = (typeof EDIT_CATEGORIES)[number];
