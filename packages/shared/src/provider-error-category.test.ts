import { describe, expect, it } from 'vitest';
import { classifyProviderHttpStatus } from './provider-error-category.js';

describe('classifyProviderHttpStatus (BUILD 21 standardized error taxonomy)', () => {
  it('classifies 401/403 as auth failure, never retryable', () => {
    expect(classifyProviderHttpStatus(401)).toEqual({ category: 'PROVIDER_AUTH_FAILED', retryable: false });
    expect(classifyProviderHttpStatus(403)).toEqual({ category: 'PROVIDER_AUTH_FAILED', retryable: false });
  });

  it('classifies 429 as rate limited, retryable', () => {
    expect(classifyProviderHttpStatus(429)).toEqual({ category: 'PROVIDER_RATE_LIMITED', retryable: true });
  });

  it('classifies 408 as timeout, retryable', () => {
    expect(classifyProviderHttpStatus(408)).toEqual({ category: 'PROVIDER_TIMEOUT', retryable: true });
  });

  it('classifies every 5xx as provider unavailable, retryable', () => {
    expect(classifyProviderHttpStatus(500)).toEqual({ category: 'PROVIDER_UNAVAILABLE', retryable: true });
    expect(classifyProviderHttpStatus(503)).toEqual({ category: 'PROVIDER_UNAVAILABLE', retryable: true });
  });

  it('classifies 400/422 as invalid request, never retryable', () => {
    expect(classifyProviderHttpStatus(400)).toEqual({ category: 'PROVIDER_INVALID_REQUEST', retryable: false });
    expect(classifyProviderHttpStatus(422)).toEqual({ category: 'PROVIDER_INVALID_REQUEST', retryable: false });
  });

  it('defaults an unrecognized status to a bad-response classification, never retryable', () => {
    expect(classifyProviderHttpStatus(451)).toEqual({ category: 'PROVIDER_BAD_RESPONSE', retryable: false });
  });
});
