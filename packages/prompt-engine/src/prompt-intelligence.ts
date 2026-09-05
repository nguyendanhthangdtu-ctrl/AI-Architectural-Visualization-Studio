import type { AutoLanguage, BilingualText, Language } from '@avs/shared';
import type {
  CameraIntelligence,
  LightingIntelligence,
  NormalizedRequest,
  ReferenceVisualLanguage,
  SourceArchitectureDNA,
  StructuralConstraints,
} from '@avs/ai-core';
import { buildCameraIntelligence, buildLightingIntelligence, deriveStructuralConstraints } from '@avs/ai-core';

/**
 * Prompt Intelligence — Architecture Amendment. The structured intermediate
 * representation between the Reasoning Engine's `NormalizedRequest`
 * (BUILD 08) and the canonical bilingual `PromptOutput` (BUILD 11 compiles
 * this; this amendment only defines the shape and a partial, honest mapping
 * — "do not implement the complete engine").
 *
 * `PromptFieldValue` fields produced by `mapNormalizedRequestToPromptIntelligence`
 * below are NOT real translations — there is no translation call here (no
 * fake AI calls, per this amendment's own instruction). Where the source
 * text exists in only one language, both `en`/`vi` mirror that same text and
 * a warning is attached. Real bilingual generation is BUILD 11's job (or a
 * later real translation/generation call), not invented here.
 */
export interface PromptFieldValue extends BilingualText {
  confidence?: number;
  warnings?: string[];
}

export interface UserPreferenceContribution {
  appliedFields: string[];
  suppressedFields: { field: string; reason: string }[];
}

export const EMPTY_USER_PREFERENCE_CONTRIBUTION: UserPreferenceContribution = { appliedFields: [], suppressedFields: [] };

export interface PromptIntelligence {
  language: { analysisLanguage: Language; outputLanguage: AutoLanguage };
  subject: PromptFieldValue;
  /** Highest priority — the user's actual source image DNA (docs/06, Architecture Lock). Null only if module/layer data is missing entirely. */
  sourceArchitecture: SourceArchitectureDNA | null;
  style: PromptFieldValue;
  details: PromptFieldValue;
  context: PromptFieldValue;
  lighting: LightingIntelligence;
  camera: CameraIntelligence;
  technicalConstraints: StructuralConstraints;
  referenceVisualLanguage: ReferenceVisualLanguage[];
  userPreferenceContribution: UserPreferenceContribution;
}

function mirrorAsPromptFieldValue(text: string, confidence?: number): PromptFieldValue {
  const value: PromptFieldValue = { en: text, vi: text };
  if (confidence !== undefined) value.confidence = confidence;
  if (text.trim()) {
    value.warnings = ['Not translated — single-language source text pending real bilingual generation (BUILD 11).'];
  }
  return value;
}

/**
 * Maps an already-resolved `NormalizedRequest` (BUILD 08 reasoning-engine
 * output) into Prompt Intelligence — the "12-layer Structured Intelligence →
 * Prompt Intelligence" step of the amendment's pipeline. Partial and
 * honest: architecture/camera/lighting/constraints are real structural
 * mappings; bilingual TEXT content is mirrored (see above), not translated.
 */
export function mapNormalizedRequestToPromptIntelligence(
  request: NormalizedRequest,
  options: {
    analysisLanguage: Language;
    outputLanguage: AutoLanguage;
    userPreferenceContribution?: UserPreferenceContribution;
  },
): PromptIntelligence {
  const layers = request.structuredIntelligence.layers;
  const architectureLock = request.locks.find((l) => l.id === 'architecture');
  const cameraLock = request.locks.find((l) => l.id === 'camera');

  const isArchitectureModule = request.structuredIntelligence.module === 'architecture';

  return {
    language: { analysisLanguage: options.analysisLanguage, outputLanguage: options.outputLanguage },
    subject: mirrorAsPromptFieldValue(layers.subject.data.description, layers.subject.confidence),
    sourceArchitecture: isArchitectureModule ? request.projectDNA.architectureDNA : null,
    style: mirrorAsPromptFieldValue(request.resolvedStyle, layers.style.confidence),
    details: mirrorAsPromptFieldValue(
      layers.material.data.materials.map((m) => `${m.type} ${m.surface}`).join(', '),
      layers.material.confidence,
    ),
    context: mirrorAsPromptFieldValue(layers.environment.data.context, layers.environment.confidence),
    lighting: buildLightingIntelligence({ dna: request.projectDNA.lightingDNA }),
    camera: buildCameraIntelligence({
      dna: request.projectDNA.cameraDNA,
      cameraLockEnabled: cameraLock?.enabled ?? false,
      isViewportSource: true, // docs/01 MVP: source is always a SketchUp/3ds Max viewport
    }),
    technicalConstraints: deriveStructuralConstraints({ architectureLockEnabled: architectureLock?.enabled ?? false }),
    referenceVisualLanguage: request.references,
    userPreferenceContribution: options.userPreferenceContribution ?? EMPTY_USER_PREFERENCE_CONTRIBUTION,
  };
}
