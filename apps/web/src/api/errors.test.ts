import { describe, expect, it } from 'vitest';
import type { ErrorEnvelope } from '@avs/shared';
import { friendlyRenderErrorMessage } from './errors.js';

function envelope(providerCode: string | undefined, message = 'raw server message'): ErrorEnvelope {
  return { code: 'NANO_BANANA_PROVIDER_ERROR', message, retryable: false, ...(providerCode ? { providerCode } : {}) };
}

describe('friendlyRenderErrorMessage (BUILD 26 Error UX)', () => {
  it('maps PROVIDER_QUOTA_EXCEEDED to the exact required quota/billing message', () => {
    expect(friendlyRenderErrorMessage(envelope('PROVIDER_QUOTA_EXCEEDED'))).toBe(
      'Gemini quota/billing is unavailable. Please try later or use Mock Mode.',
    );
  });

  it('maps PROVIDER_AUTH_FAILED to the exact required credentials message', () => {
    expect(friendlyRenderErrorMessage(envelope('PROVIDER_AUTH_FAILED'))).toBe('Gemini credentials are invalid or missing.');
  });

  it('maps PROVIDER_MODEL_NOT_FOUND to the exact required unavailable-model message', () => {
    expect(friendlyRenderErrorMessage(envelope('PROVIDER_MODEL_NOT_FOUND'))).toBe('Selected image model is unavailable.');
  });

  it('maps every other known providerCode to a real, non-empty friendly message', () => {
    for (const code of ['PROVIDER_FORBIDDEN', 'PROVIDER_RATE_LIMITED', 'PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE']) {
      const message = friendlyRenderErrorMessage(envelope(code));
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toBe('raw server message');
    }
  });

  it('never invents a message for an envelope with no providerCode — keeps the real server/client message unchanged', () => {
    expect(friendlyRenderErrorMessage(envelope(undefined, 'Invalid generation request: promptText must not be empty'))).toBe(
      'Invalid generation request: promptText must not be empty',
    );
  });

  it('never invents a message for an unrecognized providerCode', () => {
    expect(friendlyRenderErrorMessage(envelope('SOME_FUTURE_CODE_NOT_YET_MAPPED', 'raw server message'))).toBe('raw server message');
  });
});
