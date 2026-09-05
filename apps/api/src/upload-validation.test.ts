import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_DIMENSION_PX,
  MAX_UPLOAD_SIZE_BYTES,
  readImageDimensions,
  validateUpload,
} from './upload-validation.js';

// A real 1x1 PNG (smallest valid PNG, used across this repo's tests).
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function pngWithDeclaredDimensions(width: number, height: number): Uint8Array {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(0x0d0a1a0a, 4);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe('readImageDimensions', () => {
  it('reads the real dimensions from a PNG IHDR chunk', () => {
    expect(readImageDimensions('image/png', ONE_PIXEL_PNG)).toEqual({ width: 1, height: 1 });
  });

  it('returns null for a buffer without a valid PNG signature', () => {
    expect(readImageDimensions('image/png', new Uint8Array(24))).toBeNull();
  });

  it('returns null for an unsupported content type', () => {
    expect(readImageDimensions('image/gif', ONE_PIXEL_PNG)).toBeNull();
  });
});

describe('validateUpload', () => {
  it('accepts a valid, small PNG', () => {
    expect(() =>
      validateUpload({ contentType: 'image/png', sizeBytes: ONE_PIXEL_PNG.length, data: ONE_PIXEL_PNG }),
    ).not.toThrow();
  });

  it('rejects an unsupported content type', () => {
    expect(() =>
      validateUpload({ contentType: 'application/pdf', sizeBytes: ONE_PIXEL_PNG.length, data: ONE_PIXEL_PNG }),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_MEDIA_TYPE' }));
  });

  it('rejects a missing content type', () => {
    expect(() => validateUpload({ contentType: undefined, sizeBytes: 10, data: ONE_PIXEL_PNG })).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_MEDIA_TYPE' }),
    );
  });

  it('rejects a payload over the size limit', () => {
    expect(() =>
      validateUpload({ contentType: 'image/png', sizeBytes: MAX_UPLOAD_SIZE_BYTES + 1, data: ONE_PIXEL_PNG }),
    ).toThrow(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
  });

  it('rejects a corrupt image whose dimensions cannot be read', () => {
    expect(() => validateUpload({ contentType: 'image/png', sizeBytes: 10, data: new Uint8Array(24) })).toThrow(
      expect.objectContaining({ code: 'INVALID_IMAGE' }),
    );
  });

  it('rejects an image whose declared dimensions exceed the per-side limit', () => {
    const oversized = pngWithDeclaredDimensions(MAX_IMAGE_DIMENSION_PX + 1, 100);
    expect(() => validateUpload({ contentType: 'image/png', sizeBytes: oversized.length, data: oversized })).toThrow(
      expect.objectContaining({ code: 'IMAGE_DIMENSIONS_TOO_LARGE' }),
    );
  });
});
