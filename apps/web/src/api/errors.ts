import { DomainError, type ErrorEnvelope } from '@avs/shared';
import { ApiError } from './client.js';

/**
 * Converts any thrown value into a real ErrorEnvelope — shared by every
 * component that calls either a network request (throws ApiError, client.ts)
 * or a pure ai-core domain function invoked directly in the browser (throws
 * DomainError, e.g. scenarioBuilder.normalize()). One helper, not duplicated
 * per component (CLAUDE.md "No duplicated business rules").
 */
export function toErrorEnvelope(error: unknown, fallbackMessage: string): ErrorEnvelope {
  if (error instanceof ApiError) return error.envelope;
  if (error instanceof DomainError) return error.toEnvelope();
  return { code: 'UNEXPECTED_ERROR', message: fallbackMessage, retryable: true };
}

/**
 * BUILD 26 (Production UX & Render Workflow Hardening) — a real
 * user-friendly message per `providerCode` (`packages/shared/src/errors.ts`,
 * populated server-side since BUILD 21/25's `classifyProviderHttpStatus()`)
 * specifically for the render/generation error path (docs' "Error UX" rule
 * — "user-friendly message + technical category + retry guidance"). Never
 * invents a category the server doesn't actually send; an envelope with no
 * `providerCode` (a validation error, an unexpected client-side error, etc.)
 * keeps its own real, already-safe server/client message unchanged — this
 * only replaces the message for the specific provider-failure categories
 * this build's spec names.
 */
export function friendlyRenderErrorMessage(envelope: ErrorEnvelope): string {
  switch (envelope.providerCode) {
    case 'PROVIDER_AUTH_FAILED':
      return 'Gemini credentials are invalid or missing.';
    case 'PROVIDER_FORBIDDEN':
      return 'This account is not authorized to use the selected AI image model.';
    case 'PROVIDER_MODEL_NOT_FOUND':
      return 'Selected image model is unavailable.';
    case 'PROVIDER_QUOTA_EXCEEDED':
      return 'Gemini quota/billing is unavailable. Please try later or use Mock Mode.';
    case 'PROVIDER_RATE_LIMITED':
      return 'The AI provider is rate-limiting requests right now. Please wait a moment and try again.';
    case 'PROVIDER_TIMEOUT':
      return 'The AI provider took too long to respond. Please try again.';
    case 'PROVIDER_UNAVAILABLE':
      return 'The AI provider is temporarily unavailable. Please try again shortly.';
    default:
      return envelope.message;
  }
}
