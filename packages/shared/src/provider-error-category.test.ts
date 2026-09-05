import { describe, expect, it } from 'vitest';
import { classifyProviderHttpStatus } from './provider-error-category.js';

describe('classifyProviderHttpStatus (BUILD 21 standardized error taxonomy)', () => {
  it('classifies 401 as auth failure, never retryable', () => {
    expect(classifyProviderHttpStatus(401)).toEqual({ category: 'PROVIDER_AUTH_FAILED', retryable: false });
  });

  it('BUILD 25: classifies 403 as its own PROVIDER_FORBIDDEN category, distinct from 401 — a valid credential lacking permission is a different fix than an invalid one', () => {
    expect(classifyProviderHttpStatus(403)).toEqual({ category: 'PROVIDER_FORBIDDEN', retryable: false });
  });

  it('BUILD 25: classifies 404 as PROVIDER_MODEL_NOT_FOUND, never retryable', () => {
    expect(classifyProviderHttpStatus(404)).toEqual({ category: 'PROVIDER_MODEL_NOT_FOUND', retryable: false });
  });

  it('classifies 429 as rate limited, retryable, when no message is given or it does not mention quota', () => {
    expect(classifyProviderHttpStatus(429)).toEqual({ category: 'PROVIDER_RATE_LIMITED', retryable: true });
    expect(classifyProviderHttpStatus(429, 'Too many requests, please slow down')).toEqual({ category: 'PROVIDER_RATE_LIMITED', retryable: true });
  });

  it('BUILD 25: classifies a 429 whose body mentions quota as PROVIDER_QUOTA_EXCEEDED, NOT retryable — a real Gemini response observed in this project', () => {
    expect(
      classifyProviderHttpStatus(429, 'You exceeded your current quota, please check your plan and billing details.'),
    ).toEqual({ category: 'PROVIDER_QUOTA_EXCEEDED', retryable: false });
    expect(classifyProviderHttpStatus(429, 'Quota exceeded for metric generation requests')).toEqual({
      category: 'PROVIDER_QUOTA_EXCEEDED',
      retryable: false,
    });
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
