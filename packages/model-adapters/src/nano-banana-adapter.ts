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
 * Nano Banana (Google Gemini native image generation) adapter — BUILD 12,
 * validated against current official documentation (accessed 2026-09-04):
 * https://ai.google.dev/gemini-api/docs/interactions/image-generation,
 * https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image.
 * "Nano Banana" is Google's own public name for this model family — not a
 * separate product from Gemini, hence the same Interactions API endpoint
 * already used by Vision Analysis (BUILD 07) and Reference Intelligence
 * (BUILD 10), with `response_format.type: "image"` instead of JSON/text.
 *
 * BUILD 25 (Multi-Model Image Engine / Nano Banana 2) — this adapter's
 * default model was already `gemini-3.1-flash-image` ("Nano Banana 2",
 * Google's own current general-purpose image model) since BUILD 12; this
 * gate adds the previously-missing real `image_size` request field (only
 * `aspect_ratio` was ever sent) and its mapping from this app's own
 * resolution vocabulary (`SCENARIO_RESOLUTIONS`,
 * `packages/ai-core/src/scenario-vocabulary.ts`) to the four real values
 * Nano Banana 2's docs confirm: `0.5K`/`1K`/`2K`/`4K` — see
 * `mapResolutionToImageSize()`. Registered in
 * `packages/ai-core/src/image-model-registry.ts` as the app's default image
 * model.
 *
 * IMPORTANT: no NANO_BANANA_API_KEY was available at implementation time —
 * this has been validated against current documentation but NOT exercised
 * against the real API. Treat live behavior as unverified until a key is
 * supplied and this is actually run once, per CLAUDE.md rule 13.
 */
const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const DEFAULT_MODEL = 'gemini-3.1-flash-image'; // "Nano Banana 2" — current general-purpose image model at implementation time

/**
 * BUILD 25 — maps this app's own resolution vocabulary
 * (`SCENARIO_RESOLUTIONS`) to Nano Banana 2's real, documented `image_size`
 * values (uppercase `K`, per current docs). Never invents a resolution the
 * app doesn't already offer, and never sends anything outside Nano Banana
 * 2's own confirmed set. `'Preview'` maps to the model's baseline `'1K'`
 * (the registry's own default, `image-model-registry.ts`); `'6K'`/`'8K/Ultra'`
 * — resolutions this app offers for OTHER render cores (e.g. ChatGPT Image)
 * — are capped at Nano Banana 2's real maximum, `'4K'`, rather than sent
 * unmapped and rejected by the provider.
 */
function mapResolutionToImageSize(resolution: string): '0.5K' | '1K' | '2K' | '4K' {
  if (resolution === '2K') return '2K';
  if (resolution === '4K' || resolution === '6K' || resolution === '8K/Ultra') return '4K';
  return '1K'; // 'Preview', empty, or anything unrecognized — the registry's own documented default
}

export interface NanoBananaAdapterConfig {
  apiKey: string | undefined;
  model?: string;
  /** Injectable for testing — defaults to the global fetch. */
  fetchFn?: typeof fetch;
  /** BUILD 23 — real, bounded request timeout; defaults to the shared `DEFAULT_PROVIDER_TIMEOUT_MS` every other adapter already uses. */
  timeoutMs?: number;
  /**
   * BUILD 23 (cost-safe bounded retry) — default 2 (deliberately smaller
   * than the email adapter's default 3: each retry here is a real,
   * billable generation attempt, not a nuisance-only email resend).
   */
  maxAttempts?: number;
  /** Base backoff between retries, in ms; attempt N waits `retryBackoffMs * N`. */
  retryBackoffMs?: number;
}

/**
 * BUILD 23 — only a 429 (the provider explicitly rejected the request
 * before doing any real generation work) or a 5xx (the provider's own
 * infrastructure failed to accept it) is safe to retry here. A real request
 * TIMEOUT is deliberately NOT retried: this is a synchronous, single-call
 * API — if our own client gave up waiting, the provider may already be
 * mid-generation (or have already produced billable output we never
 * received), so blindly retrying could create a second real, paid
 * generation for one logical request. This is the same cost-safety
 * reasoning BUILD 21 originally used to reject ALL auto-retry for image
 * generation, narrowed here to the two cases where it's actually safe.
 */
function isRetryableGenerationFailure(error: unknown): boolean {
  return error instanceof DomainError && (error.providerCode === 'PROVIDER_RATE_LIMITED' || error.providerCode === 'PROVIDER_UNAVAILABLE');
}

function classifyGeminiError(status: number, message: string): NormalizedAdapterError {
  // BUILD 25 — the raw message is passed through (before sanitization) so a
  // real quota/billing 429 can be distinguished from a genuine rate-limit
  // 429; only the sanitized copy ever reaches the client-facing message.
  const { category, retryable } = classifyProviderHttpStatus(status, message);
  return {
    code: 'NANO_BANANA_PROVIDER_ERROR',
    message: `Gemini API error (${status}): ${sanitizeProviderErrorBody(message)}`,
    retryable,
    providerCode: category,
  };
}

function toImagePart(img: { data: Uint8Array; contentType: string }) {
  return { type: 'image', data: Buffer.from(img.data).toString('base64'), mime_type: img.contentType };
}

export function createNanoBananaAdapter(config: NanoBananaAdapterConfig): ImageGenerationAdapter {
  const fetchFn = config.fetchFn ?? fetch;
  const model = config.model ?? DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const maxAttempts = config.maxAttempts ?? 2;
  const retryBackoffMs = config.retryBackoffMs ?? 300;

  async function callInteractionsApi(input: unknown[], aspectRatio: string, resolution: string, requestId: string): Promise<GenerationResult> {
    if (!config.apiKey) {
      throw new DomainError({
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'NANO_BANANA_API_KEY is not configured — set it in .env to enable the Nano Banana adapter (docs/16).',
        retryable: false,
      });
    }

    const requestBody = {
      model,
      input,
      response_format: {
        type: 'image',
        mime_type: 'image/jpeg',
        aspect_ratio: aspectRatio,
        image_size: mapResolutionToImageSize(resolution),
      },
    };

    return withBoundedRetry(
      async () => {
        let res: Response;
        try {
          res = await fetchWithTimeout(
            fetchFn,
            GEMINI_INTERACTIONS_URL,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey! },
              body: JSON.stringify(requestBody),
            },
            timeoutMs,
          );
        } catch (error) {
          if (error instanceof ProviderTimeoutError) {
            throw new DomainError({ code: 'NANO_BANANA_PROVIDER_ERROR', message: `Gemini API request timed out: ${error.message}`, retryable: true, providerCode: 'PROVIDER_TIMEOUT' });
          }
          throw error;
        }

        if (!res.ok) {
          const bodyText = await res.text().catch(() => '');
          throw new DomainError(classifyGeminiError(res.status, bodyText || res.statusText));
        }

        const responseJson = (await res.json()) as { output_image?: { data?: string; mime_type?: string }; id?: string };
        if (!responseJson.output_image?.data) {
          return {
            status: 'failed' as const,
            outputAssetUrls: [],
            usageMetadata: { adapter: 'nano-banana', model, note: 'No output_image in response.' },
          };
        }

        const mimeType = responseJson.output_image.mime_type ?? 'image/jpeg';
        return {
          status: 'succeeded' as const,
          // docs/10 "output asset registration" — persisting this into AssetStore under a
          // permanent app URL is BUILD 13's job (Image Generation Pipeline); this is the
          // real provider output, immediately decodable, not a placeholder.
          outputAssetUrls: [`data:${mimeType};base64,${responseJson.output_image.data}`],
          usageMetadata: { adapter: 'nano-banana', model, requestId },
          ...(responseJson.id ? { providerJobId: responseJson.id } : {}),
        };
      },
      { maxAttempts, backoffMs: retryBackoffMs, isRetryable: isRetryableGenerationFailure },
    );
  }

  return {
    id: 'nano-banana',

    capabilities(): AdapterCapabilities {
      return {
        // BUILD 25 — Nano Banana 2's real, documented image_size ceiling (see mapResolutionToImageSize() above).
        maxResolution: '4K',
        supportedAspectRatios: ['1:1', '16:9', '9:16'],
        // Multimodal input (source/reference images + text) in one call is genuinely edit-like for this model family —
        // see edit()'s doc comment for the real limitation (no true pixel mask, unlike ChatGPTImageAdapter).
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
      const input = [
        { type: 'text', text: request.promptText },
        ...request.sourceAssets.map(toImagePart),
        ...request.referenceAssets.map(toImagePart),
      ];
      return callInteractionsApi(input, request.aspectRatio, request.resolution, request.requestId);
    },

    /**
     * Whole-image instructed edit — Gemini's Interactions API has no
     * documented alpha-mask input (unlike OpenAI's `/images/edits`); when a
     * caller supplies `maskAsset` anyway, it's included as an additional
     * image input with an explicit instruction to treat it as the region to
     * change, since that's the most honest thing this API can actually do
     * with it — not real pixel-level mask compositing (that only exists for
     * `ChatGPTImageAdapter`).
     */
    async edit(request: EditRequest): Promise<GenerationResult> {
      const input: unknown[] = [
        {
          type: 'text',
          text: request.maskAsset
            ? `Edit the attached image. The second attached image is a mask — treat its non-transparent area as the region to change. Change: ${request.promptText}. Preserve everything outside that region exactly.`
            : `Edit the attached image. Change: ${request.promptText}. Preserve everything else exactly.`,
        },
        toImagePart(request.sourceAsset),
        ...(request.maskAsset ? [toImagePart(request.maskAsset)] : []),
      ];
      return callInteractionsApi(input, request.aspectRatio, request.resolution, request.requestId);
    },

    normalizeError(providerError: unknown): NormalizedAdapterError {
      if (providerError instanceof DomainError) return providerError.toEnvelope() as NormalizedAdapterError;
      return {
        code: 'NANO_BANANA_PROVIDER_ERROR',
        message: providerError instanceof Error ? providerError.message : String(providerError),
        retryable: false,
      };
    },
  };
}
