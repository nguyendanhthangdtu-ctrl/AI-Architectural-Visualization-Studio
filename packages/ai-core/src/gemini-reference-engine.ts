import { DomainError } from '@avs/shared';
import { fieldKeysForPurpose, filterFieldsForPurpose } from './reference-field-vocabulary.js';
import { referenceVisualLanguageResponseSchema } from './reference-visual-language-schema.js';
import type {
  ExtractedVisualLanguage,
  ReferenceAssetRef,
  ReferenceIntelligence,
  ReferencePurpose,
} from './reference-intelligence.js';

/**
 * Google Gemini Reference Intelligence engine — BUILD 10, same provider
 * chosen for Vision Analysis (BUILD 07), validated against the same current
 * Gemini API docs (Interactions API, accessed 2026-09-04):
 * https://ai.google.dev/gemini-api/docs/structured-output,
 * https://ai.google.dev/gemini-api/docs/image-understanding,
 * https://ai.google.dev/gemini-api/docs/quickstart.
 *
 * IMPORTANT: no GEMINI_API_KEY was available at implementation time — this
 * has been validated against current documentation but NOT exercised against
 * the real API. Treat live behavior as unverified until a key is supplied
 * and this is actually run once, per CLAUDE.md rule 13.
 */
const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_WEIGHT = 1;

export interface GeminiReferenceEngineConfig {
  apiKey: string | undefined;
  model?: string;
  /** Injectable for testing — defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

const ARRAY_FIELDS = new Set(['materials', 'artificialLighting', 'influences', 'palette']);

const FIELD_DESCRIPTIONS: Record<string, string> = {
  style: 'Primary visual style',
  influences: 'Secondary style influences',
  materials: 'Material character/finish language observed (not exact per-surface geometry)',
  direction: 'Light direction as visual language',
  timeOfDay: 'Apparent time of day',
  intensity: 'Light intensity',
  softness: 'Light softness',
  shadows: 'Shadow character',
  colorTemperature: 'Color temperature',
  artificialLighting: 'Visible artificial lighting types',
  leadingLines: 'Leading lines',
  ruleOfThirds: 'Rule of thirds usage',
  goldenRatio: 'Golden ratio usage',
  symmetry: 'Symmetry',
  balance: 'Balance',
  negativeSpace: 'Negative space',
  hierarchy: 'Visual hierarchy',
  lensCharacteristic: 'Photographic lens character (not a physical camera to preserve)',
  framingStyle: 'Framing style',
  depthOfFieldLook: 'Depth-of-field look',
  setting: 'Setting',
  sky: 'Sky',
  weather: 'Weather',
  atmosphere: 'Atmosphere',
  furnishingStyle: 'Furnishing style',
  materialsUsed: 'Furnishing material language',
  arrangementMood: 'Arrangement mood',
  palette: 'Color palette',
  dominantTones: 'Dominant tones',
  saturation: 'Saturation character',
  warmCool: 'Warm/cool bias',
  cameraSystemLook: 'Camera system look',
  lensBehavior: 'Lens behavior',
  exposure: 'Exposure character',
  dynamicRange: 'Dynamic range',
  imperfections: 'Imperfections',
  realism: 'Realism character',
};

function buildPrompt(purpose: ReferencePurpose): string {
  const allowedKeys = fieldKeysForPurpose(purpose);
  return [
    'You are the Reference Intelligence engine for an architectural visualization studio (docs/08_REFERENCE_INTELLIGENCE.md).',
    `The attached image is a REFERENCE image, requested for purpose "${purpose}". Describe ONLY its visual language relevant to that purpose.`,
    `Populate ONLY these fields (omit any you cannot support from the image): ${allowedKeys.join(', ')}.`,
    'CRITICAL: Do NOT describe or infer architecture, building geometry, floor plan, massing, room layout, or exact camera position/field-of-view. This is a reference for visual language only — it must never be treated as, or substitute for, the source design. Any such content will be discarded.',
    'Include a warnings array — use it honestly when the image gives weak or ambiguous evidence for a requested field; never guess silently.',
    'Respond with JSON matching the provided schema only — no prose outside the JSON.',
  ].join('\n\n');
}

function buildResponseJsonSchema(purpose: ReferencePurpose): Record<string, unknown> {
  const allowedKeys = fieldKeysForPurpose(purpose);
  const properties: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    properties[key] = ARRAY_FIELDS.has(key)
      ? { type: 'array', items: { type: 'string' }, description: FIELD_DESCRIPTIONS[key] ?? key }
      : { type: 'string', description: FIELD_DESCRIPTIONS[key] ?? key };
  }

  return {
    type: 'object',
    properties: {
      fields: { type: 'object', properties, required: [] },
      warnings: { type: 'array', items: { type: 'string' }, description: 'Empty if none' },
    },
    required: ['fields', 'warnings'],
  };
}

function classifyGeminiError(status: number, message: string): DomainError {
  const retryable = status === 429 || status === 503 || status === 408 || status >= 500;
  return new DomainError({
    code: 'REFERENCE_PROVIDER_ERROR',
    message: `Gemini API error (${status}): ${message}`,
    retryable,
  });
}

export function createGeminiReferenceIntelligenceEngine(config: GeminiReferenceEngineConfig): ReferenceIntelligence {
  const fetchFn = config.fetchFn ?? fetch;
  const model = config.model ?? DEFAULT_MODEL;

  return {
    async extract(referenceAsset: ReferenceAssetRef, purpose: ReferencePurpose): Promise<ExtractedVisualLanguage> {
      if (!config.apiKey) {
        throw new DomainError({
          code: 'PROVIDER_NOT_CONFIGURED',
          message: 'GEMINI_API_KEY is not configured — set it in .env to enable Reference Intelligence (docs/16).',
          retryable: false,
        });
      }

      const base64Data = Buffer.from(referenceAsset.data).toString('base64');
      const requestBody = {
        model,
        input: [
          { type: 'text', text: buildPrompt(purpose) },
          { type: 'image', data: base64Data, mime_type: referenceAsset.contentType },
        ],
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: buildResponseJsonSchema(purpose),
        },
      };

      const res = await fetchFn(GEMINI_INTERACTIONS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw classifyGeminiError(res.status, bodyText || res.statusText);
      }

      const responseJson = (await res.json()) as { output_text?: string };
      if (!responseJson.output_text) {
        throw new DomainError({
          code: 'REFERENCE_PROVIDER_ERROR',
          message: 'Gemini response did not include output_text.',
          retryable: false,
        });
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(responseJson.output_text);
      } catch {
        throw new DomainError({
          code: 'REFERENCE_PROVIDER_ERROR',
          message: 'Gemini returned output_text that was not valid JSON.',
          retryable: false,
        });
      }

      const validated = referenceVisualLanguageResponseSchema.safeParse(parsed);
      if (!validated.success) {
        throw new DomainError({
          code: 'REFERENCE_PROVIDER_ERROR',
          message: `Gemini output did not match the expected structure: ${validated.error.issues.map((i) => i.message).join('; ')}`,
          retryable: false,
        });
      }

      return {
        purpose,
        weight: DEFAULT_WEIGHT,
        // Belt-and-suspenders: even a schema-valid response is re-filtered
        // against the purpose vocabulary, never trusted as-is.
        fields: filterFieldsForPurpose(purpose, validated.data.fields),
      };
    },
  };
}
