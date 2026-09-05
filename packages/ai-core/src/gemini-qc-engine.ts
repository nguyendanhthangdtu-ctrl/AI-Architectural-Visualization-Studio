import type { LockId } from '@avs/project-core';
import { DomainError, sanitizeProviderErrorBody } from '@avs/shared';
import type { AiQc, QCIssue, QCResult, QCScores, QcNormalizedRequestContext } from './qc.js';

/**
 * Google Gemini AI QC engine — BUILD 17, same provider chosen for Vision
 * Analysis (BUILD 07)/Reference Intelligence (BUILD 10), validated against
 * the same current Gemini API docs (Interactions API, accessed 2026-09-04):
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

/**
 * Product decision made at implementation time (docs/15 names no concrete
 * number) — a score below this on an attribute whose Lock is enabled is
 * treated as a real regression. Deliberately per-lock, not global: a low
 * `architectureScore` while Architecture Lock is OFF is not a QC failure,
 * it's the user's own explicit choice (CLAUDE.md rules 2-4 — locks gate what
 * must be preserved, not everything). `objectConsistencyScore`/
 * `photorealismScore` have no corresponding Lock (the 5-lock model has none
 * for "object" or general image quality) so they are always enforced.
 * Flagged for future tuning against real QC runs, not fabricated as a spec
 * value.
 */
export const QC_SCORE_THRESHOLD = 0.7;

const LOCK_ID_BY_SCORE: Partial<Record<keyof QCScores, LockId>> = {
  architectureScore: 'architecture',
  cameraScore: 'camera',
  materialScore: 'material',
  lightingScore: 'lighting',
};

const ALWAYS_ENFORCED_SCORES: (keyof QCScores)[] = ['objectConsistencyScore', 'photorealismScore'];

/**
 * Deterministic — never trusts the model's own `decision` opinion. Asking an
 * LLM to correctly cross-reference "is this score's Lock enabled" and apply a
 * numeric threshold reliably is exactly the kind of thing better done in code
 * (same philosophy as gemini-vision-engine.ts's hand-written JSON Schema:
 * "the zod schema is the actual enforcement point").
 */
export function computeQcDecision(scores: QCScores, enabledLocks: LockId[]): 'pass' | 'fail' {
  for (const [scoreKey, lockId] of Object.entries(LOCK_ID_BY_SCORE) as [keyof QCScores, LockId][]) {
    if (enabledLocks.includes(lockId) && scores[scoreKey] < QC_SCORE_THRESHOLD) return 'fail';
  }
  for (const scoreKey of ALWAYS_ENFORCED_SCORES) {
    if (scores[scoreKey] < QC_SCORE_THRESHOLD) return 'fail';
  }
  return 'pass';
}

export interface GeminiQcEngineConfig {
  apiKey: string | undefined;
  model?: string;
  /** Injectable for testing — defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

function buildPrompt(context: QcNormalizedRequestContext): string {
  const { structuredIntelligence, projectDNA, enabledLocks, resolvedStyle, instructions } = context;
  return [
    'You are the AI QC engine for an architectural visualization studio (docs/15_AI_QC_SPEC.md).',
    'The FIRST attached image is the SOURCE viewport (the original SketchUp/3ds Max render). The SECOND attached image is the GENERATED output that must be scored against it.',
    'Score exactly these 6 dimensions from 0 (completely wrong) to 1 (perfectly matches expectation): architecture, camera, material, lighting, object consistency, photorealism.',
    `Enabled Locks (attributes that MUST be preserved exactly from the source): ${enabledLocks.length > 0 ? enabledLocks.join(', ') : 'none'}. A disabled lock means that attribute was explicitly allowed to change — do not penalize a change there.`,
    `Expected source-observed structured intelligence (JSON): ${JSON.stringify(structuredIntelligence.layers)}`,
    `Expected Project DNA (JSON): ${JSON.stringify(projectDNA)}`,
    `Targeted style: "${resolvedStyle}".`,
    instructions.length > 0
      ? `Additional creative instructions the output was allowed to follow (do not penalize the output for honoring these): ${instructions.join('; ')}`
      : '',
    'For "object consistency", use the source structured intelligence\'s object layer: an object with suggestedAction "keep" must still be present and recognizable; "replace"/"add"/"edit" means a change there is expected, not an error.',
    'List every specific issue you find with its affected attribute, an approximate region when possible, a severity (low/medium/high), and a description. Also draft one correctionInstruction — a concise, actionable instruction a regeneration pass could use to fix the issues you found (or null if you found none).',
    'Never guess silently — if evidence is weak or ambiguous, say so in an issue with low severity rather than omitting it.',
    'Respond with JSON matching the provided schema only — no prose outside the JSON.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildResponseJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      scores: {
        type: 'object',
        properties: {
          architectureScore: { type: 'number', description: '0 to 1' },
          cameraScore: { type: 'number', description: '0 to 1' },
          materialScore: { type: 'number', description: '0 to 1' },
          lightingScore: { type: 'number', description: '0 to 1' },
          objectConsistencyScore: { type: 'number', description: '0 to 1' },
          photorealismScore: { type: 'number', description: '0 to 1' },
        },
        required: [
          'architectureScore',
          'cameraScore',
          'materialScore',
          'lightingScore',
          'objectConsistencyScore',
          'photorealismScore',
        ],
      },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            attribute: { type: 'string' },
            region: { type: 'string' },
            severity: { type: 'string', description: 'One of: low, medium, high' },
            description: { type: 'string' },
          },
          required: ['attribute', 'severity', 'description'],
        },
      },
      correctionInstruction: { type: ['string', 'null'] },
    },
    required: ['scores', 'issues', 'correctionInstruction'],
  };
}

function classifyGeminiError(status: number, message: string): DomainError {
  const retryable = status === 429 || status === 503 || status === 408 || status >= 500;
  return new DomainError({
    code: 'QC_PROVIDER_ERROR',
    message: `Gemini API error (${status}): ${sanitizeProviderErrorBody(message)}`,
    retryable,
  });
}

interface RawQcResponse {
  scores: QCScores;
  issues: QCIssue[];
  correctionInstruction: string | null;
}

function isValidSeverity(value: unknown): value is QCIssue['severity'] {
  return value === 'low' || value === 'medium' || value === 'high';
}

function validateResponse(parsed: unknown): RawQcResponse {
  const invalid = () =>
    new DomainError({
      code: 'QC_PROVIDER_ERROR',
      message: 'Gemini output did not match the expected QC structure.',
      retryable: false,
    });

  if (typeof parsed !== 'object' || parsed === null) throw invalid();
  const obj = parsed as Record<string, unknown>;

  const scores = obj['scores'];
  if (typeof scores !== 'object' || scores === null) throw invalid();
  const scoreObj = scores as Record<string, unknown>;
  const scoreKeys: (keyof QCScores)[] = [
    'architectureScore',
    'cameraScore',
    'materialScore',
    'lightingScore',
    'objectConsistencyScore',
    'photorealismScore',
  ];
  for (const key of scoreKeys) {
    if (typeof scoreObj[key] !== 'number') throw invalid();
  }

  const rawIssues = obj['issues'];
  if (!Array.isArray(rawIssues)) throw invalid();
  const issues: QCIssue[] = rawIssues.map((raw) => {
    if (typeof raw !== 'object' || raw === null) throw invalid();
    const issueObj = raw as Record<string, unknown>;
    if (typeof issueObj['attribute'] !== 'string') throw invalid();
    if (!isValidSeverity(issueObj['severity'])) throw invalid();
    if (typeof issueObj['description'] !== 'string') throw invalid();
    return {
      attribute: issueObj['attribute'],
      severity: issueObj['severity'],
      description: issueObj['description'],
      ...(typeof issueObj['region'] === 'string' ? { region: issueObj['region'] } : {}),
    };
  });

  const correctionInstruction = obj['correctionInstruction'];
  if (correctionInstruction !== null && typeof correctionInstruction !== 'string') throw invalid();

  return { scores: scoreObj as unknown as QCScores, issues, correctionInstruction };
}

function fallbackCorrectionInstruction(issues: QCIssue[]): string {
  const notable = issues.filter((i) => i.severity !== 'low');
  const relevant = notable.length > 0 ? notable : issues;
  return `Regenerate, addressing: ${relevant.map((i) => `${i.attribute} — ${i.description}`).join('; ')}`;
}

export function createGeminiQcEngine(config: GeminiQcEngineConfig): AiQc {
  const fetchFn = config.fetchFn ?? fetch;
  const model = config.model ?? DEFAULT_MODEL;

  return {
    async evaluate(params): Promise<QCResult> {
      if (!config.apiKey) {
        throw new DomainError({
          code: 'PROVIDER_NOT_CONFIGURED',
          message: 'GEMINI_API_KEY is not configured — set it in .env to enable AI QC (docs/16).',
          retryable: false,
        });
      }

      const { sourceAsset, outputAsset, normalizedRequest } = params;
      const sourceBase64 = Buffer.from(sourceAsset.data).toString('base64');
      const outputBase64 = Buffer.from(outputAsset.data).toString('base64');

      const requestBody = {
        model,
        input: [
          { type: 'text', text: buildPrompt(normalizedRequest) },
          { type: 'image', data: sourceBase64, mime_type: sourceAsset.contentType },
          { type: 'image', data: outputBase64, mime_type: outputAsset.contentType },
        ],
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: buildResponseJsonSchema(),
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
          code: 'QC_PROVIDER_ERROR',
          message: 'Gemini response did not include output_text.',
          retryable: false,
        });
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(responseJson.output_text);
      } catch {
        throw new DomainError({
          code: 'QC_PROVIDER_ERROR',
          message: 'Gemini returned output_text that was not valid JSON.',
          retryable: false,
        });
      }

      const validated = validateResponse(parsed);
      const decision = computeQcDecision(validated.scores, normalizedRequest.enabledLocks);

      return {
        decision,
        scores: validated.scores,
        issues: validated.issues,
        correctionInstruction:
          decision === 'fail' ? (validated.correctionInstruction ?? fallbackCorrectionInstruction(validated.issues)) : null,
      };
    },
  };
}
