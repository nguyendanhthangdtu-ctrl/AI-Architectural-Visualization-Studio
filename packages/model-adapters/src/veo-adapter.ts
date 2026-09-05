import { DomainError } from '@avs/shared';
import type { VideoGenerationAdapter } from './video-adapter.js';
import type {
  VideoAdapterCapabilities,
  VideoGenerationRequest,
  VideoOperationRef,
  VideoPollResult,
  VideoSubmission,
} from './video-types.js';
import type { NormalizedAdapterError, ValidationResult } from './types.js';

/**
 * Veo (Google Gemini API) adapter — BUILD 16, validated against current
 * official documentation (accessed 2026-09-05):
 * https://ai.google.dev/gemini-api/docs/veo, https://ai.google.dev/gemini-api/docs/video.
 * Genuinely asynchronous, unlike the Interactions API used for Nano Banana
 * (BUILD 12) — `predictLongRunning` returns an operation name immediately;
 * the caller polls a separate operation-status endpoint until `done`, then
 * reads the video URI from `response.generateVideoResponse.generatedSamples[0].video.uri`
 * and downloads it (the URI itself requires the same API key to fetch).
 *
 * IMPORTANT: no key was available at implementation time — this has been
 * validated against current documentation but NOT exercised against the
 * real API. Treat live behavior as unverified until a key is supplied and
 * this is actually run once, per CLAUDE.md rule 13.
 */
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'veo-3.1-generate-preview';
const ALLOWED_DURATIONS = [4, 6, 8];

export interface VeoAdapterConfig {
  apiKey: string | undefined;
  model?: string;
  /** Injectable for testing — defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

/** Veo's own resolution vocabulary (720p/1080p/4k) has no exact equivalent in docs/07's Resolution vocabulary — mapped, not asserted 1:1 (same pattern as ChatGPTImageAdapter's mapResolutionToQuality). */
function mapResolution(resolution: string): '720p' | '1080p' | '4k' {
  if (resolution === 'Preview') return '720p';
  if (resolution === '2K') return '1080p';
  return '4k'; // 4K / 6K / 8K/Ultra
}

/** Veo's documented aspect ratios are 16:9/9:16 — anything else in docs/07's vocabulary falls back to 16:9 rather than sending an unsupported value. */
function mapAspectRatio(aspectRatio: string): '16:9' | '9:16' {
  return aspectRatio === '9:16' || aspectRatio === '2:3' || aspectRatio === '4:3' ? '9:16' : '16:9';
}

function clampDuration(durationSeconds: number): number {
  return ALLOWED_DURATIONS.reduce((closest, allowed) =>
    Math.abs(allowed - durationSeconds) < Math.abs(closest - durationSeconds) ? allowed : closest,
  );
}

function classifyVeoError(status: number, message: string): NormalizedAdapterError {
  const retryable = status === 429 || status === 503 || status === 408 || status >= 500;
  return { code: 'VEO_PROVIDER_ERROR', message: `Veo API error (${status}): ${message}`, retryable };
}

export function createVeoAdapter(config: VeoAdapterConfig): VideoGenerationAdapter {
  const fetchFn = config.fetchFn ?? fetch;
  const model = config.model ?? DEFAULT_MODEL;

  function requireApiKey(): string {
    if (!config.apiKey) {
      throw new DomainError({
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'VEO_API_KEY is not configured — set it in .env to enable the Veo adapter (docs/16).',
        retryable: false,
      });
    }
    return config.apiKey;
  }

  return {
    id: 'veo',

    capabilities(): VideoAdapterCapabilities {
      return {
        maxDurationSeconds: 8,
        supportedAspectRatios: ['16:9', '9:16'],
        supportedResolutions: ['720p', '1080p', '4k'],
      };
    },

    validate(request: VideoGenerationRequest): ValidationResult {
      const errors: string[] = [];
      if (!request.promptText.trim()) errors.push('promptText must not be empty');
      if (!request.sourceImage) errors.push('sourceImage must be provided');
      if (request.durationSeconds <= 0) errors.push('durationSeconds must be positive');
      return { valid: errors.length === 0, errors };
    },

    async submit(request: VideoGenerationRequest): Promise<VideoSubmission> {
      const apiKey = requireApiKey();

      const requestBody = {
        instances: [
          {
            prompt: request.promptText,
            image: {
              inlineData: {
                mimeType: request.sourceImage.contentType,
                data: Buffer.from(request.sourceImage.data).toString('base64'),
              },
            },
          },
        ],
        parameters: {
          aspectRatio: mapAspectRatio(request.aspectRatio),
          resolution: mapResolution(request.resolution),
          durationSeconds: String(clampDuration(request.durationSeconds)),
        },
      };

      const res = await fetchFn(`${GEMINI_BASE_URL}/models/${model}:predictLongRunning`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new DomainError(classifyVeoError(res.status, bodyText || res.statusText));
      }

      const responseJson = (await res.json()) as { name?: string };
      if (!responseJson.name) {
        throw new DomainError({
          code: 'VEO_PROVIDER_ERROR',
          message: 'Veo API did not return an operation name.',
          retryable: false,
        });
      }
      return { operation: { operationName: responseJson.name } };
    },

    async pollStatus(operation: VideoOperationRef): Promise<VideoPollResult> {
      const apiKey = requireApiKey();

      const res = await fetchFn(`${GEMINI_BASE_URL}/${operation.operationName}`, {
        headers: { 'x-goog-api-key': apiKey },
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new DomainError(classifyVeoError(res.status, bodyText || res.statusText));
      }

      const operationJson = (await res.json()) as {
        done?: boolean;
        error?: { message?: string };
        response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] } };
      };

      if (!operationJson.done) {
        return { status: 'running', usageMetadata: { adapter: 'veo', model, operationName: operation.operationName } };
      }
      if (operationJson.error) {
        return {
          status: 'failed',
          usageMetadata: { adapter: 'veo', model, note: operationJson.error.message ?? 'Veo operation failed.' },
        };
      }

      const videoUri = operationJson.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!videoUri) {
        return {
          status: 'failed',
          usageMetadata: { adapter: 'veo', model, note: 'Veo operation completed with no video URI in the response.' },
        };
      }

      const videoRes = await fetchFn(videoUri, { headers: { 'x-goog-api-key': apiKey } });
      if (!videoRes.ok) {
        throw new DomainError(classifyVeoError(videoRes.status, `Could not download the generated video from ${videoUri}.`));
      }
      const videoBytes = new Uint8Array(await videoRes.arrayBuffer());
      const mimeType = videoRes.headers.get('content-type') ?? 'video/mp4';

      return {
        status: 'succeeded',
        outputVideoUrl: `data:${mimeType};base64,${Buffer.from(videoBytes).toString('base64')}`,
        usageMetadata: { adapter: 'veo', model, operationName: operation.operationName },
      };
    },

    normalizeError(providerError: unknown): NormalizedAdapterError {
      if (providerError instanceof DomainError) return providerError.toEnvelope() as NormalizedAdapterError;
      return {
        code: 'VEO_PROVIDER_ERROR',
        message: providerError instanceof Error ? providerError.message : String(providerError),
        retryable: false,
      };
    },
  };
}
