import type { ServerResponse } from 'node:http';
import { DomainError, type ErrorEnvelope, type Logger } from '@avs/shared';

/**
 * Centralized error handling — docs/03 §8/§9. Converts any thrown value into
 * a safe ErrorEnvelope response; never leaks a stack trace or raw
 * error/secret content to the client (CLAUDE.md rule 6, docs/16).
 */
const HTTP_STATUS_BY_CODE: Readonly<Record<string, number>> = {
  NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
  ASSET_NOT_FOUND: 404,
  NOT_IMPLEMENTED: 501,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PROVIDER_NOT_CONFIGURED: 503, // the feature exists but its provider isn't configured — not a client error
  VISION_PROVIDER_ERROR: 502, // apps/api acting as gateway to an upstream (Gemini) that failed
  REFERENCE_PROVIDER_ERROR: 502, // same — Reference Intelligence's upstream (Gemini) failed
  NANO_BANANA_PROVIDER_ERROR: 502, // same — the Nano Banana adapter's upstream (Gemini) failed
  CHATGPT_IMAGE_PROVIDER_ERROR: 502, // same — the ChatGPT Image adapter's upstream (OpenAI) failed
  UNKNOWN_RENDER_CORE: 400, // caller selected a render core with no registered adapter
  NO_ADAPTERS_REGISTERED: 503, // 'Auto' selection but nothing is registered — a deployment issue, not the caller's fault
  JOB_NOT_FOUND: 404,
  GENERATION_NOT_FOUND: 404,
  EDIT_NOT_SUPPORTED: 501, // the resolved adapter has no real edit() — never silently falls back to generate()
  VIDEO_NOT_FOUND: 404,
  VEO_PROVIDER_ERROR: 502, // apps/api acting as gateway to an upstream (Google Veo) that failed
  ANALYSIS_NOT_FOUND: 404,
  QC_PROVIDER_ERROR: 502, // apps/api acting as gateway to an upstream (Gemini) that failed
  INVALID_ASSET_SIGNATURE: 403, // signed asset URL missing/invalid/expired (docs/03 §9, BUILD 18)
  RATE_LIMITED: 429, // docs/16 "Rate limit expensive AI endpoints" (BUILD 18)
  UNAUTHENTICATED: 401, // RELEASE 02 — no/invalid/expired session
  INVALID_CREDENTIALS: 401, // RELEASE 02 — wrong email or password (never says which)
  REGISTRATION_DISABLED: 403, // RELEASE 02 — no REGISTRATION_SECRET configured on this deployment
  REGISTRATION_FORBIDDEN: 403, // RELEASE 02 — wrong registration secret
  EMAIL_ALREADY_REGISTERED: 409, // RELEASE 02
};

export function toErrorEnvelope(error: unknown): { httpStatus: number; envelope: ErrorEnvelope } {
  if (error instanceof DomainError) {
    const httpStatus = HTTP_STATUS_BY_CODE[error.code] ?? 400;
    return { httpStatus, envelope: error.toEnvelope() };
  }
  return {
    httpStatus: 500,
    envelope: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', retryable: false },
  };
}

export function sendError(res: ServerResponse, error: unknown, logger: Logger): void {
  const { httpStatus, envelope } = toErrorEnvelope(error);
  logger.error(envelope.message, { code: envelope.code, httpStatus });
  res.writeHead(httpStatus, { 'content-type': 'application/json' });
  res.end(JSON.stringify(envelope));
}
