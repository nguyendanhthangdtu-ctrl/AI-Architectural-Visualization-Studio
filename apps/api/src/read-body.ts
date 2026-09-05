import type { IncomingMessage } from 'node:http';
import { DomainError } from '@avs/shared';

/**
 * Reads a request body into a Buffer, aborting the moment `maxBytes` is
 * exceeded — never buffers an unbounded body before checking its size,
 * which would itself be the DoS vector docs/16 asks upload validation to
 * prevent.
 */
export function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        req.destroy();
        reject(
          new DomainError({
            code: 'PAYLOAD_TOO_LARGE',
            message: `Request body exceeds the ${maxBytes}-byte limit.`,
            retryable: false,
          }),
        );
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
