import type { ProjectModule } from '@avs/project-core';
import { describeArchitectureModule, describeInteriorModule } from '@avs/project-core';
import {
  classifyProviderHttpStatus,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  DomainError,
  fetchWithTimeout,
  ProviderTimeoutError,
  sanitizeProviderErrorBody,
} from '@avs/shared';
import { LAYER_NAMES, structuredIntelligenceLayersSchema } from './structured-intelligence-schema.js';
import type { SourceAssetRef, StructuredIntelligence, VisionAnalysisEngine } from './vision-analysis.js';

/**
 * Google Gemini Vision Analysis Engine — BUILD 07, provider chosen by the
 * user. Validated against the current Gemini API docs (Interactions API,
 * accessed 2026-09-04): https://ai.google.dev/gemini-api/docs/structured-output,
 * https://ai.google.dev/gemini-api/docs/image-understanding,
 * https://ai.google.dev/gemini-api/docs/quickstart.
 *
 * IMPORTANT: no GEMINI_API_KEY was available at implementation time (the
 * user chose to build without live testing) — this has been validated
 * against current documentation but NOT exercised against the real API.
 * Treat live behavior as unverified until a key is supplied and this is
 * actually run once, per CLAUDE.md rule 13.
 */
const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const DEFAULT_MODEL = 'gemini-3.8-flash';

export interface GeminiVisionEngineConfig {
  apiKey: string | undefined;
  model?: string;
  /** Injectable for testing — defaults to the global fetch. */
  fetchFn?: typeof fetch;
  /** BUILD 19 Phase 3 — real request timeout (`@avs/shared`'s `fetchWithTimeout`); defaults to `DEFAULT_PROVIDER_TIMEOUT_MS` (60s). */
  timeoutMs?: number;
}

function moduleVocabularyGuidance(module: ProjectModule): string {
  if (module === 'architecture') {
    const v = describeArchitectureModule();
    return [
      `This is an ARCHITECTURE (exterior) subject. Focus layer "architecture" on: ${v.analysisFocus.join(', ')}.`,
      `Prefer these roof type terms when applicable: ${v.roofTypes.join(', ')}.`,
      `Prefer these opening type terms when applicable: ${v.openingTypes.join(', ')}.`,
      `Prefer these facade element terms when applicable: ${v.facadeElements.join(', ')}.`,
      `For layer "object", prefer these site/exterior object categories: ${v.objectCategories.join(', ')}.`,
    ].join('\n');
  }
  const v = describeInteriorModule();
  return [
    `This is an INTERIOR subject. Focus layer "architecture" on: ${v.analysisFocus.join(', ')}.`,
    `Prefer these wall treatment terms when applicable: ${v.wallTreatments.join(', ')}.`,
    `Prefer these floor finish terms when applicable: ${v.floorFinishes.join(', ')}.`,
    `Prefer these ceiling treatment terms when applicable: ${v.ceilingTreatments.join(', ')}.`,
    `For layer "object", prefer these furnishing object categories: ${v.objectCategories.join(', ')}.`,
  ].join('\n');
}

function buildPrompt(module: ProjectModule): string {
  return [
    'You are the Vision Analysis Engine for an architectural visualization studio (docs/05_AI_ANALYSIS_SPEC.md).',
    'Analyze the attached image and return structured data for exactly these 12 layers: ' +
      LAYER_NAMES.join(', ') +
      '.',
    'For every layer, include a confidence score from 0 to 1 and a warnings array — use warnings and lower confidence honestly when evidence in the image is weak or ambiguous. Never guess silently.',
    'Layer "subject": type is either "building" or "space", with a short description.',
    'Layer "style": identify the architectural/interior style (e.g. Modern, Contemporary, Minimalism, Japandi, Luxury, Wabi Sabi, Scandinavian, Tropical, Neo Classic); default to "Modern Contemporary" when evidence is insufficient, per spec.',
    'Layer "object": for each notable object, suggest one action: keep, edit, replace, or add.',
    'Layer "realLifeLook": describe this as professional architectural photography by default.',
    'Layer "constraints": list any noted uncertainties from your analysis.',
    moduleVocabularyGuidance(module),
    'Respond with JSON matching the provided schema only — no prose outside the JSON.',
  ].join('\n\n');
}

/**
 * Hand-written JSON Schema (not derived from the zod schema) restricted to
 * the documented-supported subset — string/number/integer/boolean/object/
 * array/null. Enum support was not confirmed in the docs fetched at
 * implementation time, so allowed values are specified in prose (the prompt
 * above + each field's description) rather than the `enum` keyword; the zod
 * schema (structured-intelligence-schema.ts) is the actual enforcement point
 * once a response comes back.
 */
function buildResponseJsonSchema(): Record<string, unknown> {
  const textField = (description: string) => ({ type: 'string', description });
  const stringArray = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
  const layer = (dataProperties: Record<string, unknown>, dataRequired: string[]) => ({
    type: 'object',
    properties: {
      confidence: { type: 'number', description: '0 to 1' },
      warnings: stringArray('Empty if none'),
      data: { type: 'object', properties: dataProperties, required: dataRequired },
    },
    required: ['confidence', 'warnings', 'data'],
  });

  return {
    type: 'object',
    properties: {
      subject: layer({ type: textField('"building" or "space"'), description: textField('Short description') }, [
        'type',
        'description',
      ]),
      architecture: layer(
        {
          geometry: textField('Overall massing/geometry'),
          openings: textField('Windows, doors, and other openings'),
          roof: textField('Roof type and description'),
          facade: textField('Facade elements and treatment'),
          floorPlan: textField('Floor plan characteristics'),
          ceiling: textField('Ceiling type and height'),
          stairs: textField('Stair type, or "none visible"'),
          proportions: textField('Overall proportions'),
        },
        ['geometry', 'openings', 'roof', 'facade', 'floorPlan', 'ceiling', 'stairs', 'proportions'],
      ),
      style: layer({ style: textField('Primary style'), influences: stringArray('Secondary influences') }, [
        'style',
        'influences',
      ]),
      camera: layer(
        {
          heightMeters: { type: ['number', 'null'], description: 'Estimated camera height in meters' },
          lens: { type: ['string', 'null'], description: 'Apparent lens type' },
          fieldOfViewDegrees: { type: ['number', 'null'], description: 'Estimated field of view' },
          perspective: { type: ['string', 'null'], description: 'Perspective description' },
          eyeLevel: { type: ['string', 'null'], description: 'Eye level description' },
          projection: { type: ['string', 'null'], description: 'Projection type' },
          verticalCorrection: { type: ['string', 'null'], description: 'Vertical correction notes' },
        },
        ['heightMeters', 'lens', 'fieldOfViewDegrees', 'perspective', 'eyeLevel', 'projection', 'verticalCorrection'],
      ),
      composition: layer(
        {
          leadingLines: textField('Leading lines'),
          ruleOfThirds: textField('Rule of thirds'),
          goldenRatio: textField('Golden ratio'),
          symmetry: textField('Symmetry'),
          balance: textField('Balance'),
          negativeSpace: textField('Negative space'),
          hierarchy: textField('Visual hierarchy'),
        },
        ['leadingLines', 'ruleOfThirds', 'goldenRatio', 'symmetry', 'balance', 'negativeSpace', 'hierarchy'],
      ),
      material: layer(
        {
          materials: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                surface: textField('Which surface'),
                type: textField('Material type'),
                finish: textField('Finish'),
                roughness: textField('Roughness'),
                reflectance: textField('Reflectance'),
              },
              required: ['surface', 'type', 'finish', 'roughness', 'reflectance'],
            },
          },
        },
        ['materials'],
      ),
      lighting: layer(
        {
          direction: textField('Light direction'),
          timeOfDay: textField('Apparent time of day'),
          intensity: textField('Intensity'),
          softness: textField('Softness'),
          shadows: textField('Shadow character'),
          colorTemperature: textField('Color temperature'),
          artificialLighting: stringArray('Visible artificial lighting'),
        },
        ['direction', 'timeOfDay', 'intensity', 'softness', 'shadows', 'colorTemperature', 'artificialLighting'],
      ),
      environment: layer(
        {
          setting: textField('Setting'),
          sky: textField('Sky'),
          weather: textField('Weather'),
          context: textField('Context'),
        },
        ['setting', 'sky', 'weather', 'context'],
      ),
      object: layer(
        {
          objects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: textField('Object label'),
                category: textField('Object category'),
                suggestedAction: textField('One of: keep, edit, replace, add'),
              },
              required: ['label', 'category', 'suggestedAction'],
            },
          },
        },
        ['objects'],
      ),
      photography: layer(
        {
          cameraSystemLook: textField('Camera system look'),
          lensBehavior: textField('Lens behavior'),
          exposure: textField('Exposure'),
          dynamicRange: textField('Dynamic range'),
          depth: textField('Depth of field'),
          imperfections: textField('Imperfections'),
        },
        ['cameraSystemLook', 'lensBehavior', 'exposure', 'dynamicRange', 'depth', 'imperfections'],
      ),
      realLifeLook: layer({ description: textField('Real-life photography description') }, ['description']),
      constraints: layer({ notedUncertainties: stringArray('Noted uncertainties') }, ['notedUncertainties']),
    },
    required: [...LAYER_NAMES],
  };
}

function classifyGeminiError(status: number, message: string): DomainError {
  const { category, retryable } = classifyProviderHttpStatus(status);
  return new DomainError({
    code: 'VISION_PROVIDER_ERROR',
    message: `Gemini API error (${status}): ${sanitizeProviderErrorBody(message)}`,
    retryable,
    providerCode: category,
  });
}

export function createGeminiVisionAnalysisEngine(config: GeminiVisionEngineConfig): VisionAnalysisEngine {
  const fetchFn = config.fetchFn ?? fetch;
  const model = config.model ?? DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;

  return {
    async analyze(sourceAsset: SourceAssetRef, module: ProjectModule): Promise<StructuredIntelligence> {
      if (!config.apiKey) {
        throw new DomainError({
          code: 'PROVIDER_NOT_CONFIGURED',
          message: 'GEMINI_API_KEY is not configured — set it in .env to enable Vision Analysis (docs/16).',
          retryable: false,
        });
      }

      const base64Data = Buffer.from(sourceAsset.data).toString('base64');
      const requestBody = {
        model,
        input: [
          { type: 'text', text: buildPrompt(module) },
          { type: 'image', data: base64Data, mime_type: sourceAsset.contentType },
        ],
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: buildResponseJsonSchema(),
        },
      };

      let res: Response;
      try {
        res = await fetchWithTimeout(
          fetchFn,
          GEMINI_INTERACTIONS_URL,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
            body: JSON.stringify(requestBody),
          },
          timeoutMs,
        );
      } catch (error) {
        if (error instanceof ProviderTimeoutError) {
          throw new DomainError({ code: 'VISION_PROVIDER_ERROR', message: `Gemini API request timed out: ${error.message}`, retryable: true });
        }
        throw error;
      }

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw classifyGeminiError(res.status, bodyText || res.statusText);
      }

      const responseJson = (await res.json()) as { output_text?: string };
      if (!responseJson.output_text) {
        throw new DomainError({
          code: 'VISION_PROVIDER_ERROR',
          message: 'Gemini response did not include output_text.',
          retryable: false,
        });
      }

      let parsedLayers: unknown;
      try {
        parsedLayers = JSON.parse(responseJson.output_text);
      } catch {
        throw new DomainError({
          code: 'VISION_PROVIDER_ERROR',
          message: 'Gemini returned output_text that was not valid JSON.',
          retryable: false,
        });
      }

      const validated = structuredIntelligenceLayersSchema.safeParse(parsedLayers);
      if (!validated.success) {
        throw new DomainError({
          code: 'VISION_PROVIDER_ERROR',
          message: `Gemini output did not match the expected structure: ${validated.error.issues.map((i) => i.message).join('; ')}`,
          retryable: false,
        });
      }

      return {
        analysisVersion: `gemini:${model}:${new Date().toISOString()}`,
        module,
        layers: validated.data,
      };
    },
  };
}
