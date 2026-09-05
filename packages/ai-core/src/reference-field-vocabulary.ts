import type { ReferencePurpose } from './reference-intelligence.js';

/**
 * Reference visual-language field vocabulary — docs/08_REFERENCE_INTELLIGENCE.md
 * "Reference transmits visual language according to purpose, not source
 * architecture." This is the single source of truth for which fields a
 * reference extraction may ever populate for a given purpose; deliberately,
 * no purpose's field set includes anything geometry/floor-plan/structural —
 * that vocabulary belongs only to `architectureLayerSchema`
 * (structured-intelligence-schema.ts) and must never appear here.
 */
const STYLE_FIELDS = ['style', 'influences'] as const;
const MATERIAL_FIELDS = ['materials'] as const;
const LIGHTING_FIELDS = [
  'direction',
  'timeOfDay',
  'intensity',
  'softness',
  'shadows',
  'colorTemperature',
  'artificialLighting',
] as const;
const COMPOSITION_FIELDS = [
  'leadingLines',
  'ruleOfThirds',
  'goldenRatio',
  'symmetry',
  'balance',
  'negativeSpace',
  'hierarchy',
] as const;
/**
 * Photographic camera *character*, not the physical camera the source image
 * was shot from — the actual camera (position/height/FOV/perspective) is
 * `CameraDNA`, sourced only from the source image and protected by Camera
 * Lock (docs/03 ADR-001). A reference's "camera" purpose may only describe
 * lens/framing feel, never a position or FOV number to preserve/override.
 */
const CAMERA_FIELDS = ['lensCharacteristic', 'framingStyle', 'depthOfFieldLook'] as const;
const ENVIRONMENT_FIELDS = ['setting', 'sky', 'weather', 'atmosphere'] as const;
const FURNITURE_FIELDS = ['furnishingStyle', 'materialsUsed', 'arrangementMood'] as const;
const COLOR_FIELDS = ['palette', 'dominantTones', 'saturation', 'warmCool'] as const;
const PHOTOGRAPHY_FIELDS = ['cameraSystemLook', 'lensBehavior', 'exposure', 'dynamicRange', 'imperfections'] as const;
const REALISM_FIELDS = ['realism'] as const;

const OVERALL_LOOK_FIELDS = [
  ...STYLE_FIELDS,
  ...MATERIAL_FIELDS,
  ...LIGHTING_FIELDS,
  ...COMPOSITION_FIELDS,
  ...CAMERA_FIELDS,
  ...ENVIRONMENT_FIELDS,
  ...FURNITURE_FIELDS,
  ...COLOR_FIELDS,
  ...PHOTOGRAPHY_FIELDS,
  ...REALISM_FIELDS,
] as const;

export const REFERENCE_PURPOSE_FIELD_KEYS: Readonly<Record<ReferencePurpose, readonly string[]>> = {
  style: STYLE_FIELDS,
  material: MATERIAL_FIELDS,
  lighting: LIGHTING_FIELDS,
  composition: COMPOSITION_FIELDS,
  camera: CAMERA_FIELDS,
  environment: ENVIRONMENT_FIELDS,
  furniture: FURNITURE_FIELDS,
  color: COLOR_FIELDS,
  'overall-look': OVERALL_LOOK_FIELDS,
  auto: OVERALL_LOOK_FIELDS,
};

/** Runtime vocabulary for UI `<select>` options — same pattern as scenario-vocabulary.ts. */
export const REFERENCE_PURPOSES: readonly ReferencePurpose[] = [
  'style',
  'material',
  'lighting',
  'composition',
  'camera',
  'environment',
  'furniture',
  'color',
  'overall-look',
  'auto',
];

export function fieldKeysForPurpose(purpose: ReferencePurpose): readonly string[] {
  return REFERENCE_PURPOSE_FIELD_KEYS[purpose];
}

/**
 * Structural enforcement of CLAUDE.md rule 5, applied even to a model's raw
 * output — not merely documented as a prompt instruction. Any key outside
 * the purpose's allowed vocabulary (an "architecture", "geometry",
 * "floorPlan" leak included) is dropped here, unconditionally, before an
 * `ExtractedVisualLanguage` is ever constructed.
 */
export function filterFieldsForPurpose(
  purpose: ReferencePurpose,
  rawFields: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set(fieldKeysForPurpose(purpose));
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawFields)) {
    if (allowed.has(key)) filtered[key] = value;
  }
  return filtered;
}
