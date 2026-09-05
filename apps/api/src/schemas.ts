import { z } from '@avs/shared';

/**
 * Request-body schema validation at the API boundary — CLAUDE.md coding
 * standard "Schema validation at system boundaries." docs/01 MVP step 1
 * "Create project" + step 3 "Select Architecture or Interior".
 */
export const createProjectRequestSchema = z.object({
  name: z.string().trim().min(1, 'name must not be empty').max(200),
  module: z.enum(['architecture', 'interior']),
});

export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

/**
 * RELEASE 02 (Security & Production Access Hardening) — real accounts.
 * `registrationSecret` gates self-registration for a private deployment
 * (docs/16); a real minimum length on `password` (not just "non-empty") is
 * the one strength rule enforced at this boundary — real password-strength
 * scoring is out of scope for this release.
 */
export const registerRequestSchema = z.object({
  email: z.string().trim().min(1, 'email must not be empty').email('email must be a valid email address'),
  password: z.string().min(8, 'password must be at least 8 characters'),
  registrationSecret: z.string().min(1, 'registrationSecret must not be empty'),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().trim().min(1, 'email must not be empty'),
  password: z.string().min(1, 'password must not be empty'),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * BUILD 19 (Account Recovery). `requestPasswordResetRequestSchema` only
 * validates shape (a real email-shaped string) — the route itself never
 * reveals whether the address is actually registered (enumeration
 * protection is a runtime-behavior guarantee, not a schema one).
 */
export const requestPasswordResetRequestSchema = z.object({
  email: z.string().trim().min(1, 'email must not be empty').email('email must be a valid email address'),
});

export type RequestPasswordResetRequest = z.infer<typeof requestPasswordResetRequestSchema>;

export const confirmPasswordResetRequestSchema = z.object({
  token: z.string().trim().min(1, 'token must not be empty'),
  newPassword: z.string().min(8, 'newPassword must be at least 8 characters'),
});

export type ConfirmPasswordResetRequest = z.infer<typeof confirmPasswordResetRequestSchema>;

/** docs/01 MVP step 4 "Run 12-layer AI analysis" (BUILD 07). */
export const runAnalysisRequestSchema = z.object({
  assetId: z.string().trim().min(1, 'assetId must not be empty'),
});

export type RunAnalysisRequest = z.infer<typeof runAnalysisRequestSchema>;

/** docs/08_REFERENCE_INTELLIGENCE.md "Reference purpose" (BUILD 10). */
export const referencePurposeSchema = z.enum([
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
]);

export const runReferenceExtractionRequestSchema = z.object({
  assetId: z.string().trim().min(1, 'assetId must not be empty'),
  purpose: referencePurposeSchema,
  weight: z.number().min(0).max(1).optional(),
});

export type RunReferenceExtractionRequest = z.infer<typeof runReferenceExtractionRequestSchema>;

/** docs/07_SCENARIO_BUILDER_SPEC.md render-core vocabulary (BUILD 13) — the same Title Case values ScenarioSlots collects. */
export const renderCoreSchema = z.enum(['Nano Banana', 'Google Flow', 'ChatGPT Image', 'Auto']);

/** docs/11_IMAGE_GENERATION_SPEC.md step 1 "Validate request" (BUILD 13). */
export const runGenerationRequestSchema = z.object({
  promptText: z.string().trim().min(1, 'promptText must not be empty'),
  renderCore: renderCoreSchema,
  aspectRatio: z.string().trim().min(1, 'aspectRatio must not be empty'),
  resolution: z.string().trim().min(1, 'resolution must not be empty'),
  sourceAssetId: z.string().trim().min(1, 'sourceAssetId must not be empty'),
  referenceAssetIds: z.array(z.string().trim().min(1)).default([]),
  promptVersion: z.string().trim().min(1, 'promptVersion must not be empty'),
  scenarioVersion: z.string().trim().min(1, 'scenarioVersion must not be empty'),
});

export type RunGenerationRequest = z.infer<typeof runGenerationRequestSchema>;

/** docs/12_EDITOR_SPEC.md category vocabulary (BUILD 14) — mirrors packages/project-core's EDIT_CATEGORIES exactly (project-core can't be a runtime dep of the wire-schema layer's own literal list, so this is kept in sync by hand and asserted equal in tests). */
export const editCategorySchema = z.enum([
  'inpaint-outpaint',
  'material-replacement',
  'furniture-object-replacement',
  'people-vegetation-vehicles-decor-environment',
  'lighting-atmosphere',
  'other',
]);

export const lockIdSchema = z.enum(['architecture', 'camera', 'material', 'style', 'lighting']);

/** docs/12 "Each edit must declare: target region, intended change, protected regions/locks... " (BUILD 14). */
export const runEditRequestSchema = z.object({
  sourceAssetId: z.string().trim().min(1, 'sourceAssetId must not be empty'),
  targetRegionDescription: z.string().trim().min(1, 'targetRegionDescription must not be empty'),
  maskAssetId: z.string().trim().min(1).optional(),
  intendedChange: z.string().trim().min(1, 'intendedChange must not be empty'),
  category: editCategorySchema,
  protectedLocks: z.array(lockIdSchema).default([]),
  aspectRatio: z.string().trim().min(1, 'aspectRatio must not be empty'),
  resolution: z.string().trim().min(1, 'resolution must not be empty'),
});

export type RunEditRequest = z.infer<typeof runEditRequestSchema>;

/** docs/13_MULTIVIEW_SPEC.md proposal shapes (BUILD 15) — real `Partial<CameraDNA>`/`Partial<MaterialDNA>`/`Partial<LightingDNA>` at the wire boundary, mirroring packages/project-core's dna.ts field names exactly. */
export const cameraProposalSchema = z
  .object({
    height: z.number().nullable(),
    lens: z.string().nullable(),
    fieldOfView: z.number().nullable(),
    perspective: z.string().nullable(),
    eyeLevel: z.string().nullable(),
    projection: z.string().nullable(),
    verticalCorrection: z.string().nullable(),
  })
  .partial();

export const materialProposalSchema = z.object({
  assignments: z.record(
    z.string(),
    z.object({ type: z.string(), finish: z.string(), roughness: z.string(), reflectance: z.string() }),
  ),
});

export const lightingProposalSchema = z
  .object({
    direction: z.string().nullable(),
    timeOfDay: z.string().nullable(),
    intensity: z.string().nullable(),
    softness: z.string().nullable(),
    colorTemperature: z.string().nullable(),
    artificialLighting: z.array(z.string()),
  })
  .partial();

export const viewModeSchema = z.enum(['sync', 'creative']);

/** docs/13 "Version tree: every view/generation is linked to its parent version and project snapshot" (BUILD 15). Extends the generation request — a View still submits an already-compiled prompt (BUILD 11) and runs the same real provider call (BUILD 13). */
export const runViewRequestSchema = runGenerationRequestSchema.extend({
  mode: viewModeSchema,
  cameraProposal: cameraProposalSchema.optional(),
  materialProposal: materialProposalSchema.optional(),
  lightingProposal: lightingProposalSchema.optional(),
  styleProposal: z.string().trim().min(1).optional(),
  ignoredProposals: z.array(z.string()).default([]),
});

export type RunViewRequest = z.infer<typeof runViewRequestSchema>;

/** docs/14_VIDEO_SPEC.md motion vocabulary (BUILD 16) — mirrors packages/project-core's VIDEO_MOTION_TYPES exactly (kept in sync by hand, same reasoning as editCategorySchema above). */
export const videoMotionTypeSchema = z.enum([
  'dolly',
  'pan',
  'orbit',
  'crane',
  'push-in',
  'pull-out',
  'people',
  'trees',
  'curtains',
  'light',
  'atmosphere',
]);

/** Video render-core vocabulary (BUILD 16) — same Title Case UI convention as renderCoreSchema. */
export const videoRenderCoreSchema = z.enum(['Veo', 'Sora', 'Auto']);

/** docs/14 "Input: final image + Project DNA + motion plan" (BUILD 16). */
export const runVideoRequestSchema = z.object({
  sourceAssetId: z.string().trim().min(1, 'sourceAssetId must not be empty'),
  promptText: z.string().trim().min(1, 'promptText must not be empty'),
  motionType: videoMotionTypeSchema,
  motionDescription: z.string().trim().min(1, 'motionDescription must not be empty'),
  durationSeconds: z.number().positive(),
  aspectRatio: z.string().trim().min(1, 'aspectRatio must not be empty'),
  resolution: z.string().trim().min(1, 'resolution must not be empty'),
  renderCore: videoRenderCoreSchema,
});

export type RunVideoRequest = z.infer<typeof runVideoRequestSchema>;

/**
 * docs/15_AI_QC_SPEC.md (BUILD 17) — "expected structured intent" QC compares
 * the output against. Only `locks` (which attributes must be preserved) needs
 * real per-field validation here: `structuredIntelligence`/`projectDNA` are
 * NOT re-transmitted by the client — `analysisId` looks up the already
 * real-validated `AnalysisRecord` from BUILD 07 (avoids re-deriving/
 * duplicating the 12-layer zod schema at this boundary, CLAUDE.md rule 9).
 */
export const qcLockStateSchema = z.object({ id: lockIdSchema, enabled: z.boolean() });

export const runQcRequestSchema = z.object({
  analysisId: z.string().trim().min(1, 'analysisId must not be empty'),
  outputAssetId: z.string().trim().min(1).optional(),
  locks: z.array(qcLockStateSchema).length(5, 'locks must include exactly the 5 known locks'),
  resolvedStyle: z.string().trim().min(1).optional(),
  instructions: z.array(z.string()).default([]),
});

export type RunQcRequest = z.infer<typeof runQcRequestSchema>;

/**
 * docs/03 §4 VERIFY→CREATE loop (BUILD 17) — same shape as a normal
 * generation request (the client re-resolves the Reasoning Engine with the
 * correction folded into `instructions` and recompiles, same as any other
 * render) plus the `correctionInstruction` that triggered it, kept for
 * provenance (CLAUDE.md rule 14).
 */
export const runRegenerateRequestSchema = runGenerationRequestSchema.extend({
  correctionInstruction: z.string().trim().min(1, 'correctionInstruction must not be empty'),
});

export type RunRegenerateRequest = z.infer<typeof runRegenerateRequestSchema>;
