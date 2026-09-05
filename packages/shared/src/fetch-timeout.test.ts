import { describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, ProviderTimeoutError } from './fetch-timeout.js';

describe('fetchWithTimeout', () => {
  it('returns the real response when the call finishes before the timeout', async () => {
    const response = new Response('ok');
    const fetchFn = vi.fn().mockResolvedValue(response);
    const result = await fetchWithTimeout(fetchFn, 'https://example.com', {}, 1000);
    expect(result).toBe(response);
  });

  it('passes an AbortSignal through to the underlying fetch call', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('ok'));
    await fetchWithTimeout(fetchFn, 'https://example.com', { method: 'POST' }, 1000);
    const [, init] = fetchFn.mock.calls[0]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.method).toBe('POST');
  });

  it('throws a real ProviderTimeoutError when the call hangs past the timeout', async () => {
    const fetchFn = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    await expect(fetchWithTimeout(fetchFn as unknown as typeof fetch, 'https://example.com', {}, 10)).rejects.toThrow(
      ProviderTimeoutError,
    );
  });

  it('propagates a real, non-abort error unchanged', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('DNS lookup failed'));
    await expect(fetchWithTimeout(fetchFn, 'https://example.com', {}, 1000)).rejects.toThrow('DNS lookup failed');
  });
});
