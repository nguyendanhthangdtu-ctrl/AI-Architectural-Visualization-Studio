import { describe, expect, it } from 'vitest';
import { sanitizeProviderErrorBody } from './provider-error-sanitizer.js';

describe('sanitizeProviderErrorBody', () => {
  it('passes short, plain-text bodies through unchanged', () => {
    expect(sanitizeProviderErrorBody('Bad Request')).toBe('Bad Request');
  });

  it('redacts a long opaque token-shaped substring (e.g. an echoed API key)', () => {
    const body = 'Invalid key: sk-abcdefghijklmnopqrstuvwxyz0123456789 provided';
    const result = sanitizeProviderErrorBody(body);
    expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(result).toContain('[REDACTED]');
  });

  it('truncates a very long body to a bounded length', () => {
    const body = 'x'.repeat(1000);
    const result = sanitizeProviderErrorBody(body);
    expect(result.length).toBeLessThan(400);
    expect(result.endsWith('…')).toBe(true);
  });

  it('does not redact ordinary short words even if repeated', () => {
    expect(sanitizeProviderErrorBody('rate limit exceeded, try again later')).toBe('rate limit exceeded, try again later');
  });
});
