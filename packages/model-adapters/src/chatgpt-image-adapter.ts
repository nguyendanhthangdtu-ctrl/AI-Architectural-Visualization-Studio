import {
  classifyProviderHttpStatus,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  DomainError,
  fetchWithTimeout,
  ProviderTimeoutError,
  sanitizeProviderErrorBody,
  withBoundedRetry,
} from '@avs/shared';
import type { ImageGenerationAdapter } from './adapter.js';
import type {
  AdapterCapabilities,
  EditRequest,
  GenerationRequest,
  GenerationResult,
  NormalizedAdapterError,
  ValidationResult,
} from './types.js';

/**
 * ChatGPT Image (OpenAI gpt-image-1) adapter — BUILD 12 (generate), BUILD 14
 * (edit), validated against current official documentation (accessed
 * 2026-09-04): https://developers.openai.com/api/docs/guides/image-generation,
 * https://developers.openai.com/api/reference/resources/images/methods/generate,
 * and the Images Edit endpoint (multipart/form-data: image, optional mask,
 * prompt, model, size — mask fully-transparent area = editable region, PNG,
 * same dimensions as the source image, <4MB). `response_format` is
 * deliberately NOT sent on either call — unlike dall-e-2/3, gpt-image-1 and
 * later models don't support it and always return `b64_json`.
 *
 * IMPORTANT: no CHATGPT_IMAGE_API_KEY was available at implementation time —
 * this has been validated against current documentation but NOT exercised
 * against the real API. Treat live behavior as unverified until a key is
 * supplied and this is actually run once, per CLAUDE.md rule 13. A
 * community-reported issue (openai-node#1844, 2026-04) noted the edits
 * endpoint rejecting GPT Image models in some configurations — worth
 * re-checking against current docs if this returns unexpected errors live.
 */
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const OPENAI_IMAGES_EDIT_URL = 'https://api.openai.com/v1/images/edits';
const DEFAULT_MODEL = 'gpt-image-1';

export interface ChatGPTImageAdapterConfig {
  apiKey: string | undefined;
  model?: string;
  /** Injectable for testing — defaults to the global fetch. */
  fetchFn?: typeof fetch;
  /** BUILD 23 — real, bounded request timeout; defaults to the shared `DEFAULT_PROVIDER_TIMEOUT_MS` every other adapter already uses. */
  timeoutMs?: number;
  /** BUILD 23 (cost-safe bounded retry) — default 2: each retry here is a real, billable generation attempt. */
  maxAttempts?: number;
  /** Base backoff between retries, in ms; attempt N waits `retryBackoffMs * N`. */
  retryBackoffMs?: number;
}

/** BUILD 23 — see nano-banana-adapter.ts's identical function for the full cost-safety reasoning: only a 429/5xx is safe to retry; a real client-side timeout never is. */
function isRetryableGenerationFailure(error: unknown): boolean {
  return error instanceof DomainError && (error.providerCode === 'PROVIDER_RATE_LIMITED' || error.providerCode === 'PROVIDER_UNAVAILABLE');
}

/** gpt-image-1 accepts a fixed set of pixel sizes, not the app's own aspect-ratio vocabulary — a real, documented per-provider mapping (docs/10 "maps the canonical generation request to provider-specific capabilities"). */
function mapAspectRatioToSize(aspectRatio: string): string {
  if (aspectRatio === '1:1') return '1024x1024';
  if (['16:9', '3:2', '21:9'].includes(aspectRatio)) return '1536x1024';
  if (['9:16', '2:3'].includes(aspectRatio)) return '1024x1536';
  return 'auto';
}

/** The app's own resolution vocabulary (docs/07) has no exact equivalent in gpt-image-1's quality enum — mapped, not asserted 1:1. */
function mapResolutionToQuality(resolution: string): 'low' | 'medium' | 'high' | 'auto' {
  if (resolution === 'Preview') return 'low';
  if (resolution === '2K') return 'medium';
  if (resolution === '4K' || resolution === '6K' || resolution === '8K/Ultra') return 'high';
  return 'auto';
}

function classifyOpenAiError(status: number, message: string): NormalizedAdapterError {
  const { category, retryable } = classifyProviderHttpStatus(status);
  return {
    code: 'CHATGPT_IMAGE_PROVIDER_ERROR',
    message: `OpenAI Images API error (${status}): ${sanitizeProviderErrorBody(message)}`,
    retryable,
    providerCode: category,
  };
}

export function createChatGPTImageAdapter(config: ChatGPTImageAdapterConfig): ImageGenerationAdapter {
  const fetchFn = config.fetchFn ?? fetch;
  const model = config.model ?? DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const maxAttempts = config.maxAttempts ?? 2;
  const retryBackoffMs = config.retryBackoffMs ?? 300;

  return {
    id: 'chatgpt-image',

    capabilities(): AdapterCapabilities {
      return {
        maxResolution: '1536x1024',
        supportedAspectRatios: ['1:1', '16:9', '9:16', '3:2', '2:3'],
        // Real /images/edits call (BUILD 14) — genuine pixel-mask support, unlike NanoBananaAdapter.
        supportsEdit: true,
        supportsUpscale: false,
      };
    },

    validate(request: GenerationRequest): ValidationResult {
      const errors: string[] = [];
      if (!request.promptText.trim()) errors.push('promptText must not be empty');
      if (request.sourceAssets.length === 0) errors.push('sourceAssets must not be empty');
      return { valid: errors.length === 0, errors };
    },

    async generate(request: GenerationRequest): Promise<GenerationResult> {
      if (!config.apiKey) {
        throw new DomainError({
          code: 'PROVIDER_NOT_CONFIGURED',
          message: 'CHATGPT_IMAGE_API_KEY is not configured — set it in .env to enable the ChatGPT Image adapter (docs/16).',
          retryable: false,
        });
      }

      const requestBody = {
        model,
        prompt: request.promptText,
        size: mapAspectRatioToSize(request.aspectRatio),
        quality: mapResolutionToQuality(request.resolution),
        n: 1,
      };

      return withBoundedRetry(
        async () => {
          let res: Response;
          try {
            res = await fetchWithTimeout(
              fetchFn,
              OPENAI_IMAGES_URL,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
                body: JSON.stringify(requestBody),
              },
              timeoutMs,
            );
          } catch (error) {
            if (error instanceof ProviderTimeoutError) {
              throw new DomainError({ code: 'CHATGPT_IMAGE_PROVIDER_ERROR', message: `OpenAI Images API request timed out: ${error.message}`, retryable: true, providerCode: 'PROVIDER_TIMEOUT' });
            }
            throw error;
          }

          if (!res.ok) {
            const bodyText = await res.text().catch(() => '');
            throw new DomainError(classifyOpenAiError(res.status, bodyText || res.statusText));
          }

          const responseJson = (await res.json()) as {
            data?: { b64_json?: string; revised_prompt?: string }[];
            usage?: Record<string, unknown>;
          };
          const image = responseJson.data?.[0];
          if (!image?.b64_json) {
            return {
              status: 'failed' as const,
              outputAssetUrls: [],
              usageMetadata: { adapter: 'chatgpt-image', model, note: 'No image data in response.' },
            };
          }

          return {
            status: 'succeeded' as const,
            // docs/10 "output asset registration" — persisting this into AssetStore under a
            // permanent app URL is BUILD 13's job (Image Generation Pipeline); this is the
            // real provider output, immediately decodable, not a placeholder.
            outputAssetUrls: [`data:image/png;base64,${image.b64_json}`],
            usageMetadata: {
              adapter: 'chatgpt-image',
              model,
              requestId: request.requestId,
              ...(image.revised_prompt ? { revisedPrompt: image.revised_prompt } : {}),
              ...(responseJson.usage ? { usage: responseJson.usage } : {}),
            },
          };
        },
        { maxAttempts, backoffMs: retryBackoffMs, isRetryable: isRetryableGenerationFailure },
      );
    },

    /**
     * Real masked or whole-image edit via OpenAI's `/images/edits` endpoint
     * — genuine multipart/form-data (not JSON): `fetch` computes the
     * boundary itself from a `FormData` body, so no `content-type` header is
     * set manually here (setting one would break the boundary parameter).
     */
    async edit(request: EditRequest): Promise<GenerationResult> {
      if (!config.apiKey) {
        throw new DomainError({
          code: 'PROVIDER_NOT_CONFIGURED',
          message: 'CHATGPT_IMAGE_API_KEY is not configured — set it in .env to enable the ChatGPT Image adapter (docs/16).',
          retryable: false,
        });
      }

      return withBoundedRetry(
        async () => {
          // Rebuilt fresh per attempt — a FormData/Blob body should never be reused across a retried fetch call.
          const form = new FormData();
          form.append('model', model);
          form.append('prompt', request.promptText);
          form.append('image', new Blob([request.sourceAsset.data], { type: request.sourceAsset.contentType }), 'source.png');
          if (request.maskAsset) {
            form.append('mask', new Blob([request.maskAsset.data], { type: 'image/png' }), 'mask.png');
          }
          form.append('size', mapAspectRatioToSize(request.aspectRatio));
          form.append('n', '1');

          let res: Response;
          try {
            res = await fetchWithTimeout(
              fetchFn,
              OPENAI_IMAGES_EDIT_URL,
              {
                method: 'POST',
                headers: { authorization: `Bearer ${config.apiKey}` },
                body: form,
              },
              timeoutMs,
            );
          } catch (error) {
            if (error instanceof ProviderTimeoutError) {
              throw new DomainError({ code: 'CHATGPT_IMAGE_PROVIDER_ERROR', message: `OpenAI Images API request timed out: ${error.message}`, retryable: true, providerCode: 'PROVIDER_TIMEOUT' });
            }
            throw error;
          }

          if (!res.ok) {
            const bodyText = await res.text().catch(() => '');
            throw new DomainError(classifyOpenAiError(res.status, bodyText || res.statusText));
          }

          const responseJson = (await res.json()) as { data?: { b64_json?: string }[] };
          const image = responseJson.data?.[0];
          if (!image?.b64_json) {
            return {
              status: 'failed' as const,
              outputAssetUrls: [],
              usageMetadata: { adapter: 'chatgpt-image', model, note: 'No image data in edit response.' },
            };
          }

          return {
            status: 'succeeded' as const,
            outputAssetUrls: [`data:image/png;base64,${image.b64_json}`],
            usageMetadata: { adapter: 'chatgpt-image', model, requestId: request.requestId, masked: Boolean(request.maskAsset) },
          };
        },
        { maxAttempts, backoffMs: retryBackoffMs, isRetryable: isRetryableGenerationFailure },
      );
    },

    normalizeError(providerError: unknown): NormalizedAdapterError {
      if (providerError instanceof DomainError) return providerError.toEnvelope() as NormalizedAdapterError;
      return {
        code: 'CHATGPT_IMAGE_PROVIDER_ERROR',
        message: providerError instanceof Error ? providerError.message : String(providerError),
        retryable: false,
      };
    },
  };
}
