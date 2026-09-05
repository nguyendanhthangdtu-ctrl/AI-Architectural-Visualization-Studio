import { DomainError } from '@avs/shared';
import {
  SCENARIO_ARTIFICIAL_LIGHTING_OPTIONS,
  SCENARIO_ASPECT_RATIOS,
  SCENARIO_CAMERA_MODES,
  SCENARIO_CONTEXTS,
  SCENARIO_ENVIRONMENTS,
  SCENARIO_LIGHTING_OPTIONS,
  SCENARIO_RENDER_CORES,
  SCENARIO_RESOLUTIONS,
  SCENARIO_SUN_DIRECTIONS,
} from './scenario-vocabulary.js';

/** Scenario Builder contract — docs/07_SCENARIO_BUILDER_SPEC.md. */
export interface ScenarioInput {
  context: string;
  lighting: string;
  sunDirection: string;
  artificialLighting: string[];
  environment: string;
  cameraMode: string;
  aspectRatio: string;
  generationResolution: string;
  upscaleResolution: string;
  renderCore: string;
}

export type NormalizedScenario = ScenarioInput & { normalizedAt: string };

export interface ScenarioBuilder {
  normalize(input: ScenarioInput): Promise<NormalizedScenario>;
}

/** Matches `value` against `vocabulary` case/whitespace-insensitively, returning the vocabulary's canonical casing. */
function matchVocabulary(value: string, vocabulary: readonly string[]): string | null {
  const trimmed = value.trim();
  return vocabulary.find((option) => option.toLowerCase() === trimmed.toLowerCase()) ?? null;
}

function validateField(fieldName: string, value: string, vocabulary: readonly string[], errors: string[]): string {
  if (!value.trim()) {
    errors.push(`${fieldName} is required.`);
    return value;
  }
  const matched = matchVocabulary(value, vocabulary);
  if (!matched) {
    errors.push(`${fieldName} "${value}" is not one of: ${vocabulary.join(', ')}.`);
    return value;
  }
  return matched;
}

/**
 * Normalizes a Scenario Builder input — docs/07 "Scenario must be normalized
 * before prompt compilation." Every field is validated against its closed
 * docs/07 vocabulary (case/whitespace-insensitive, canonicalized on match);
 * an incomplete or invalid scenario is rejected outright with every problem
 * listed at once, never partially accepted.
 */
export const scenarioBuilder: ScenarioBuilder = {
  async normalize(input: ScenarioInput): Promise<NormalizedScenario> {
    const errors: string[] = [];

    const context = validateField('context', input.context, SCENARIO_CONTEXTS, errors);
    const lighting = validateField('lighting', input.lighting, SCENARIO_LIGHTING_OPTIONS, errors);
    const sunDirection = validateField('sunDirection', input.sunDirection, SCENARIO_SUN_DIRECTIONS, errors);
    const environment = validateField('environment', input.environment, SCENARIO_ENVIRONMENTS, errors);
    const cameraMode = validateField('cameraMode', input.cameraMode, SCENARIO_CAMERA_MODES, errors);
    const aspectRatio = validateField('aspectRatio', input.aspectRatio, SCENARIO_ASPECT_RATIOS, errors);
    const generationResolution = validateField(
      'generationResolution',
      input.generationResolution,
      SCENARIO_RESOLUTIONS,
      errors,
    );
    const upscaleResolution = validateField('upscaleResolution', input.upscaleResolution, SCENARIO_RESOLUTIONS, errors);
    const renderCore = validateField('renderCore', input.renderCore, SCENARIO_RENDER_CORES, errors);

    // Artificial lighting is optional (a scene may have none) and multi-select — validate each entry, dedupe, keep first-seen order.
    const seen = new Set<string>();
    const artificialLighting: string[] = [];
    for (const entry of input.artificialLighting) {
      const matched = matchVocabulary(entry, SCENARIO_ARTIFICIAL_LIGHTING_OPTIONS);
      if (!matched) {
        errors.push(`artificialLighting "${entry}" is not one of: ${SCENARIO_ARTIFICIAL_LIGHTING_OPTIONS.join(', ')}.`);
        continue;
      }
      if (!seen.has(matched)) {
        seen.add(matched);
        artificialLighting.push(matched);
      }
    }

    if (errors.length > 0) {
      throw new DomainError({
        code: 'VALIDATION_ERROR',
        message: `Invalid scenario: ${errors.join(' ')}`,
        retryable: false,
      });
    }

    return {
      context,
      lighting,
      sunDirection,
      artificialLighting,
      environment,
      cameraMode,
      aspectRatio,
      generationResolution,
      upscaleResolution,
      renderCore,
      normalizedAt: new Date().toISOString(),
    };
  },
};

/** Alias matching BUILD 02 service-boundary naming; same contract as ScenarioBuilder. */
export type ScenarioService = ScenarioBuilder;
/** Domain-foundation alias for the normalized Scenario entity (docs/04 Data Model). */
export type Scenario = NormalizedScenario;
