import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { resolveClientIp } from './rate-limit-middleware.js';

function fakeRequest(params: { remoteAddress?: string; xForwardedFor?: string | string[] }): IncomingMessage {
  return {
    socket: { remoteAddress: params.remoteAddress },
    headers: params.xForwardedFor !== undefined ? { 'x-forwarded-for': params.xForwardedFor } : {},
  } as unknown as IncomingMessage;
}

describe('resolveClientIp (BUILD 32 Production Deployment)', () => {
  it('trustProxy=false (the default): always uses the real socket address, ignoring any X-Forwarded-For header', () => {
    const req = fakeRequest({ remoteAddress: '10.0.0.1', xForwardedFor: '1.2.3.4' });
    expect(resolveClientIp(req, false)).toBe('10.0.0.1');
  });

  it('trustProxy=true: uses the leftmost X-Forwarded-For address (the original client, one reverse-proxy hop)', () => {
    const req = fakeRequest({ remoteAddress: '10.0.0.1', xForwardedFor: '1.2.3.4, 10.0.0.1' });
    expect(resolveClientIp(req, true)).toBe('1.2.3.4');
  });

  it('trustProxy=true: falls back to the socket address when no X-Forwarded-For header is present (a direct connection)', () => {
    const req = fakeRequest({ remoteAddress: '10.0.0.1' });
    expect(resolveClientIp(req, true)).toBe('10.0.0.1');
  });

  it('never returns undefined — falls back to the literal string "unknown" when nothing is available', () => {
    const req = fakeRequest({});
    expect(resolveClientIp(req, false)).toBe('unknown');
  });
});
