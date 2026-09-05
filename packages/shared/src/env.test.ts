import { describe, expect, it } from 'vitest';
import { parseServerEnv, parsePublicEnv, SECRET_ENV_KEYS } from './env.js';

describe('parseServerEnv', () => {
  it('succeeds with an empty environment — no secret is required for local bootstrap', () => {
    const env = parseServerEnv({});
    expect(env.API_PORT).toBe(8080);
    expect(env.NANO_BANANA_API_KEY).toBeUndefined();
  });

  it('coerces and accepts a valid API_PORT override', () => {
    const env = parseServerEnv({ API_PORT: '3000' });
    expect(env.API_PORT).toBe(3000);
  });

  it('rejects an invalid API_PORT rather than silently falling back', () => {
    expect(() => parseServerEnv({ API_PORT: 'not-a-port' })).toThrow();
  });

  it('lists every credential field as a secret to redact from logs', () => {
    expect(SECRET_ENV_KEYS).toEqual(
      expect.arrayContaining([
        'NANO_BANANA_API_KEY',
        'GOOGLE_FLOW_API_KEY',
        'CHATGPT_IMAGE_API_KEY',
        'DATABASE_URL',
        'ASSET_URL_SIGNING_SECRET',
        'REGISTRATION_SECRET',
      ]),
    );
  });

  it('defaults TRUST_HTTPS to false, and parses "true"/"false" as real booleans (not JS truthiness)', () => {
    expect(parseServerEnv({}).TRUST_HTTPS).toBe(false);
    expect(parseServerEnv({ TRUST_HTTPS: 'true', ASSET_URL_SIGNING_SECRET: 'x' }).TRUST_HTTPS).toBe(true);
    expect(parseServerEnv({ TRUST_HTTPS: 'false' }).TRUST_HTTPS).toBe(false);
  });

  it('rejects a non-"true"/"false" TRUST_HTTPS value rather than silently coercing it', () => {
    expect(() => parseServerEnv({ TRUST_HTTPS: 'yes' })).toThrow();
  });

  it('BUILD 19 Phase 5: fails fast when TRUST_HTTPS=true but ASSET_URL_SIGNING_SECRET is missing', () => {
    expect(() => parseServerEnv({ TRUST_HTTPS: 'true' })).toThrow(/ASSET_URL_SIGNING_SECRET/);
  });

  it('succeeds when TRUST_HTTPS=true and ASSET_URL_SIGNING_SECRET is set', () => {
    expect(() => parseServerEnv({ TRUST_HTTPS: 'true', ASSET_URL_SIGNING_SECRET: 'a-real-secret' })).not.toThrow();
  });

  it('does not require ASSET_URL_SIGNING_SECRET when TRUST_HTTPS is false (the default)', () => {
    expect(() => parseServerEnv({})).not.toThrow();
  });
});

describe('parsePublicEnv', () => {
  it('succeeds with an empty environment (no public fields defined yet)', () => {
    expect(parsePublicEnv({})).toEqual({});
  });
});
