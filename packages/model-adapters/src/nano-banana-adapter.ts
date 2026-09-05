import { DomainError, sanitizeProviderErrorBody } from '@avs/shared';
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
 * IMPORTANT: no NANO_BANANA_API_KEY was available at implementation time —
 * this has been validated against current documentation but NOT exercised
 * against the real API. Treat live behavior as unverified until a key is
 * supplied and this is actually run once, per CLAUDE.md rule 13.
 */
const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const DEFAULT_MODEL = 'gemini-3.1-flash-image'; // "Nano Banana 2" — current general-purpose image model at implementation time

export interface NanoBananaAdapterConfig {
  apiKey: string | undefined;
  model?: string;
  /** Injectable for testing — defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

function classifyGeminiError(status: number, message: string): NormalizedAdapterError {
  const retryable = status === 429 || status === 503 || status === 408 || status >= 500;
  return { code: 'NANO_BANANA_PROVIDER_ERROR', message: `Gemini API error (${status}): ${sanitizeProviderErrorBody(message)}`, retryable };
}

function toImagePart(img: { data: Uint8Array; contentType: string }) {
  return { type: 'image', data: Buffer.from(img.data).toString('base64'), mime_type: img.contentType };
}

export function createNanoBananaAdapter(config: NanoBananaAdapterConfig): ImageGenerationAdapter {
  const fetchFn = config.fetchFn ?? fetch;
  const model = config.model ?? DEFAULT_MODEL;

  async function callInteractionsApi(input: unknown[], aspectRatio: string, requestId: string): Promise<GenerationResult> {
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
      response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: aspectRatio },
    };

    const res = await fetchFn(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new DomainError(classifyGeminiError(res.status, bodyText || res.statusText));
    }

    const responseJson = (await res.json()) as { output_image?: { data?: string; mime_type?: string }; id?: string };
    if (!responseJson.output_image?.data) {
      return {
        status: 'failed',
        outputAssetUrls: [],
        usageMetadata: { adapter: 'nano-banana', model, note: 'No output_image in response.' },
      };
    }

    const mimeType = responseJson.output_image.mime_type ?? 'image/jpeg';
    return {
      status: 'succeeded',
      // docs/10 "output asset registration" — persisting this into AssetStore under a
      // permanent app URL is BUILD 13's job (Image Generation Pipeline); this is the
      // real provider output, immediately decodable, not a placeholder.
      outputAssetUrls: [`data:${mimeType};base64,${responseJson.output_image.data}`],
      usageMetadata: { adapter: 'nano-banana', model, requestId },
      ...(responseJson.id ? { providerJobId: responseJson.id } : {}),
    };
  }

  return {
    id: 'nano-banana',

    capabilities(): AdapterCapabilities {
      return {
        // Conservative — only what current docs confirmed at implementation time (image_size "1K" example seen); not asserting higher tiers unverified.
        maxResolution: '1K',
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
      return callInteractionsApi(input, request.aspectRatio, request.requestId);
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
      return callInteractionsApi(input, request.aspectRatio, request.requestId);
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
