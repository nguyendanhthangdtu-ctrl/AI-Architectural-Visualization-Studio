import { describe, expect, it, vi, afterEach } from 'vitest';
import { createConsoleLogger } from './logger.js';

describe('createConsoleLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts known secret-shaped keys from logged context', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = createConsoleLogger();
    logger.error('provider call failed', { apiKey: 'sk-super-secret', requestId: 'req-1' });
    const logged = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(logged.context.apiKey).toBe('[REDACTED]');
    expect(logged.context.requestId).toBe('req-1');
  });

  it('redacts every env.ts SECRET_ENV_KEYS name too (BUILD 18 — closes a real drift gap)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = createConsoleLogger();
    logger.error('config dump', { DATABASE_URL: 'postgres://user:pass@host/db', API_PORT: 8080 });
    const logged = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(logged.context.DATABASE_URL).toBe('[REDACTED]');
    expect(logged.context.API_PORT).toBe(8080);
  });
});
