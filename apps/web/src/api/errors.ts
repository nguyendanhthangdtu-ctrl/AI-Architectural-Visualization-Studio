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
