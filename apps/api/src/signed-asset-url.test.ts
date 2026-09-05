import { describe, expect, it, vi } from 'vitest';
import { buildAssetUrl, createAssetUrlSigner } from './signed-asset-url.js';

describe('createAssetUrlSigner', () => {
  it('returns null when no secret is configured — callers stay plain/unsigned', () => {
    expect(createAssetUrlSigner(undefined)).toBeNull();
  });

  it('signs and verifies a real asset id', () => {
    const signer = createAssetUrlSigner('test-secret')!;
    const { expiresAt, signature } = signer.sign('asset-1');
    expect(signer.verify('asset-1', expiresAt, signature)).toBe(true);
  });

  it('rejects a signature for a different asset id', () => {
    const signer = createAssetUrlSigner('test-secret')!;
    const { expiresAt, signature } = signer.sign('asset-1');
    expect(signer.verify('asset-2', expiresAt, signature)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const signer = createAssetUrlSigner('test-secret')!;
    const { expiresAt } = signer.sign('asset-1');
    expect(signer.verify('asset-1', expiresAt, 'deadbeef'.repeat(8))).toBe(false);
  });

  it('rejects an expired signature', () => {
    vi.useFakeTimers();
    try {
      const signer = createAssetUrlSigner('test-secret', 60)!;
      const { expiresAt, signature } = signer.sign('asset-1');
      vi.advanceTimersByTime(61_000);
      expect(signer.verify('asset-1', expiresAt, signature)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a malformed (non-hex) signature without throwing', () => {
    const signer = createAssetUrlSigner('test-secret')!;
    const { expiresAt } = signer.sign('asset-1');
    expect(signer.verify('asset-1', expiresAt, 'not-hex!!')).toBe(false);
  });
});

describe('buildAssetUrl', () => {
  it('returns a plain path when no signer is configured', () => {
    expect(buildAssetUrl(null, 'asset-1')).toBe('/assets/asset-1');
  });

  it('returns a signed path when a signer is configured', () => {
    const signer = createAssetUrlSigner('test-secret')!;
    const url = buildAssetUrl(signer, 'asset-1');
    expect(url).toMatch(/^\/assets\/asset-1\?exp=\d+&sig=[0-9a-f]+$/);
  });
});
