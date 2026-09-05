import { z } from '@avs/shared';

/**
 * Structured Intelligence schema — the real per-layer shape docs/05's 12
 * layers actually produce (BUILD 07). Replaces the loose
 * `Record<string, unknown>` placeholder from Bootstrap (vision-analysis.ts's
 * original comment: "kept intentionally loose here so Bootstrap does not
 * invent a data contract that gate must own" — this is that gate).
 *
 * Every layer carries `confidence` (0-1) and `warnings` — docs/05 "Include
 * confidence/uncertainty where evidence is weak," never silently guessed.
 */
const layerEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    confidence: z.number().min(0).max(1),
    warnings: z.array(z.string()),
    data,
  });

export const subjectLayerSchema = layerEnvelope(
  z.object({
    type: z.enum(['building', 'space']),
    description: z.string(),
  }),
);

/** docs/05 layer 2 — field names shared across modules; content differs by ProjectModule. */
export const architectureLayerSchema = layerEnvelope(
  z.object({
    geometry: z.string(),
    openings: z.string(),
    roof: z.string(),
    facade: z.string(),
    floorPlan: z.string(),
    ceiling: z.string(),
    stairs: z.string(),
    proportions: z.string(),
  }),
);

export const styleLayerSchema = layerEnvelope(
  z.object({
    style: z.string(),
    influences: z.array(z.string()),
  }),
);

export const cameraLayerSchema = layerEnvelope(
  z.object({
    heightMeters: z.number().nullable(),
    lens: z.string().nullable(),
    fieldOfViewDegrees: z.number().nullable(),
    perspective: z.string().nullable(),
    eyeLevel: z.string().nullable(),
    projection: z.string().nullable(),
    verticalCorrection: z.string().nullable(),
  }),
);

export const compositionLayerSchema = layerEnvelope(
  z.object({
    leadingLines: z.string(),
    ruleOfThirds: z.string(),
    goldenRatio: z.string(),
    symmetry: z.string(),
    balance: z.string(),
    negativeSpace: z.string(),
    hierarchy: z.string(),
  }),
);

export const materialLayerSchema = layerEnvelope(
  z.object({
    materials: z.array(
      z.object({
        surface: z.string(),
        type: z.string(),
        finish: z.string(),
        roughness: z.string(),
        reflectance: z.string(),
      }),
    ),
  }),
);

export const lightingLayerSchema = layerEnvelope(
  z.object({
    direction: z.string(),
    timeOfDay: z.string(),
    intensity: z.string(),
    softness: z.string(),
    shadows: z.string(),
    colorTemperature: z.string(),
    artificialLighting: z.array(z.string()),
  }),
);

export const environmentLayerSchema = layerEnvelope(
  z.object({
    setting: z.string(),
    sky: z.string(),
    weather: z.string(),
    context: z.string(),
  }),
);

/** docs/05 layer 9 — module-specific object vocabulary (architecture-module.ts / interior-module.ts) informs the prompt, not this schema's shape. */
export const objectLayerSchema = layerEnvelope(
  z.object({
    objects: z.array(
      z.object({
        label: z.string(),
        category: z.string(),
        suggestedAction: z.enum(['keep', 'edit', 'replace', 'add']),
      }),
    ),
  }),
);

export const photographyLayerSchema = layerEnvelope(
  z.object({
    cameraSystemLook: z.string(),
    lensBehavior: z.string(),
    exposure: z.string(),
    dynamicRange: z.string(),
    depth: z.string(),
    imperfections: z.string(),
  }),
);

export const realLifeLookLayerSchema = layerEnvelope(
  z.object({
    description: z.string(),
  }),
);

export const constraintsLayerSchema = layerEnvelope(
  z.object({
    notedUncertainties: z.array(z.string()),
  }),
);

export const structuredIntelligenceLayersSchema = z.object({
  subject: subjectLayerSchema,
  architecture: architectureLayerSchema,
  style: styleLayerSchema,
  camera: cameraLayerSchema,
  composition: compositionLayerSchema,
  material: materialLayerSchema,
  lighting: lightingLayerSchema,
  environment: environmentLayerSchema,
  object: objectLayerSchema,
  photography: photographyLayerSchema,
  realLifeLook: realLifeLookLayerSchema,
  constraints: constraintsLayerSchema,
});

export type StructuredIntelligenceLayers = z.infer<typeof structuredIntelligenceLayersSchema>;
export type LayerName = keyof StructuredIntelligenceLayers;

export const LAYER_NAMES: readonly LayerName[] = [
  'subject',
  'architecture',
  'style',
  'camera',
  'composition',
  'material',
  'lighting',
  'environment',
  'object',
  'photography',
  'realLifeLook',
  'constraints',
];
