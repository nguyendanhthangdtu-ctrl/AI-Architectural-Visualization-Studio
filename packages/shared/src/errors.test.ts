import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';

describe('DomainError', () => {
  it('produces an envelope without leaking undefined optional fields', () => {
    const error = new DomainError({ code: 'NOT_FOUND', message: 'missing', retryable: false });
    expect(error.toEnvelope()).toEqual({ code: 'NOT_FOUND', message: 'missing', retryable: false });
  });

  it('includes providerCode and requestId when provided', () => {
    const error = new DomainError({
      code: 'PROVIDER_ERROR',
      message: 'upstream failed',
      retryable: true,
      providerCode: 'RATE_LIMIT',
    });
    expect(error.toEnvelope('req-1')).toEqual({
      code: 'PROVIDER_ERROR',
      message: 'upstream failed',
      retryable: true,
      providerCode: 'RATE_LIMIT',
      requestId: 'req-1',
    });
  });
});
