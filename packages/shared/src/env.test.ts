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

  it('BUILD 22: succeeds with no EMAIL_PROVIDER set — dev/local mode never requires an email credential', () => {
    expect(() => parseServerEnv({})).not.toThrow();
    expect(parseServerEnv({}).EMAIL_PROVIDER).toBeUndefined();
  });

  it('BUILD 22: rejects an unsupported EMAIL_PROVIDER value rather than silently accepting an unimplemented vendor', () => {
    expect(() => parseServerEnv({ EMAIL_PROVIDER: 'sendgrid' })).toThrow();
  });

  it('BUILD 22: fails fast when EMAIL_PROVIDER=resend but RESEND_API_KEY is missing', () => {
    expect(() => parseServerEnv({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'noreply@example.com' })).toThrow(/RESEND_API_KEY/);
  });

  it('BUILD 22: fails fast when EMAIL_PROVIDER=resend but EMAIL_FROM is missing', () => {
    expect(() => parseServerEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'a-real-key' })).toThrow(/EMAIL_FROM/);
  });

  it('BUILD 22: succeeds when EMAIL_PROVIDER=resend with both RESEND_API_KEY and EMAIL_FROM set', () => {
    expect(() => parseServerEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'a-real-key', EMAIL_FROM: 'noreply@example.com' })).not.toThrow();
  });

  it('BUILD 22: rejects a malformed EMAIL_FROM/EMAIL_REPLY_TO address', () => {
    expect(() => parseServerEnv({ EMAIL_FROM: 'not-an-email' })).toThrow();
    expect(() => parseServerEnv({ EMAIL_REPLY_TO: 'not-an-email' })).toThrow();
  });

  it('BUILD 22: lists RESEND_API_KEY as a secret to redact from logs', () => {
    expect(SECRET_ENV_KEYS).toEqual(expect.arrayContaining(['RESEND_API_KEY']));
  });
});

describe('parsePublicEnv', () => {
  it('succeeds with an empty environment (no public fields defined yet)', () => {
    expect(parsePublicEnv({})).toEqual({});
  });
});
