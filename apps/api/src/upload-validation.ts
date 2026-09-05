import { DomainError } from '@avs/shared';

/**
 * Upload validation — docs/16_SECURITY_SPEC.md "Validate file type, size,
 * dimensions, and upload permissions." Runs at the API boundary, before
 * anything reaches AssetStore.put() (docs/03 §9).
 */
export const ALLOWED_IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg'] as const;
export type AllowedImageContentType = (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

export const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB — generous for a viewport render export
export const MAX_IMAGE_DIMENSION_PX = 16000; // guards against decompression-bomb-style dimension abuse

function isAllowedContentType(contentType: string): contentType is AllowedImageContentType {
  return (ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType);
}

/** Reads width/height from a PNG's fixed-offset IHDR chunk, or a JPEG's first SOF marker. Returns null if unparseable. */
export function readImageDimensions(contentType: string, data: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (contentType === 'image/png') {
    const hasPngSignature = data.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a;
    if (!hasPngSignature) return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (contentType === 'image/jpeg') {
    if (data.length < 4 || view.getUint16(0) !== 0xffd8) return null;
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (view.getUint8(offset) !== 0xff) return null;
      const marker = view.getUint8(offset + 1);
      const isStandaloneMarker = marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7);
      if (isStandaloneMarker) {
        offset += 2;
        continue;
      }
      const segmentLength = view.getUint16(offset + 2);
      const isSofMarker = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSofMarker && offset + 9 <= data.length) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + segmentLength;
    }
    return null;
  }

  return null;
}

export function validateUpload(params: { contentType: string | undefined; sizeBytes: number; data: Uint8Array }): void {
  const { contentType, sizeBytes, data } = params;

  if (!contentType || !isAllowedContentType(contentType)) {
    throw new DomainError({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: `Unsupported content type "${contentType ?? '(none)'}"; allowed: ${ALLOWED_IMAGE_CONTENT_TYPES.join(', ')}.`,
      retryable: false,
    });
  }

  if (sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    throw new DomainError({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Upload of ${sizeBytes} bytes exceeds the ${MAX_UPLOAD_SIZE_BYTES}-byte limit.`,
      retryable: false,
    });
  }

  const dimensions = readImageDimensions(contentType, data);
  if (!dimensions) {
    throw new DomainError({
      code: 'INVALID_IMAGE',
      message: `Could not read image dimensions for declared content type "${contentType}" — file may be corrupt.`,
      retryable: false,
    });
  }
  if (dimensions.width > MAX_IMAGE_DIMENSION_PX || dimensions.height > MAX_IMAGE_DIMENSION_PX) {
    throw new DomainError({
      code: 'IMAGE_DIMENSIONS_TOO_LARGE',
      message: `Image is ${dimensions.width}x${dimensions.height}px, exceeding the ${MAX_IMAGE_DIMENSION_PX}px limit per side.`,
      retryable: false,
    });
  }
}
