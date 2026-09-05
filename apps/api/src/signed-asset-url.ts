import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed, time-limited asset URLs — docs/03 §9 "signed, time-limited URLs
 * from AssetStore — no public bucket by default" (BUILD 18 hardening;
 * `GET /assets/:id` was previously a plain, unguarded fetch by guessable id).
 * `createAssetUrlSigner()` returns `null` when `ASSET_URL_SIGNING_SECRET`
 * isn't configured — every asset URL this API builds/serves then stays
 * exactly today's plain, unsigned behavior (same graceful-degradation
 * pattern as every optional provider key in `env.ts`), so local dev/tests
 * never need this secret to run.
 */
export interface AssetUrlSigner {
  sign(assetId: string): { expiresAt: number; signature: string };
  verify(assetId: string, expiresAt: number, signature: string): boolean;
}

const DEFAULT_TTL_SECONDS = 3600;

export function createAssetUrlSigner(secret: string | undefined, ttlSeconds = DEFAULT_TTL_SECONDS): AssetUrlSigner | null {
  if (!secret) return null;
  const secretValue: string = secret;

  function computeSignature(assetId: string, expiresAt: number): string {
    return createHmac('sha256', secretValue).update(`${assetId}:${expiresAt}`).digest('hex');
  }

  return {
    sign(assetId: string) {
      const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
      return { expiresAt, signature: computeSignature(assetId, expiresAt) };
    },
    verify(assetId: string, expiresAt: number, signature: string): boolean {
      if (!Number.isFinite(expiresAt) || Math.floor(Date.now() / 1000) > expiresAt) return false;
      const expected = Buffer.from(computeSignature(assetId, expiresAt), 'hex');
      let given: Buffer;
      try {
        given = Buffer.from(signature, 'hex');
      } catch {
        return false;
      }
      if (expected.length !== given.length) return false;
      return timingSafeEqual(expected, given);
    },
  };
}

/** Builds the URL this API returns for an asset — signed when a signer is configured, plain otherwise. */
export function buildAssetUrl(signer: AssetUrlSigner | null, assetId: string): string {
  if (!signer) return `/assets/${assetId}`;
  const { expiresAt, signature } = signer.sign(assetId);
  return `/assets/${assetId}?exp=${expiresAt}&sig=${signature}`;
}
