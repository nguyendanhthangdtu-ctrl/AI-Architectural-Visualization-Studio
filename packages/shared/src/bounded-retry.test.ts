import { describe, expect, it, vi } from 'vitest';
import { withBoundedRetry } from './bounded-retry.js';

describe('withBoundedRetry (BUILD 23 shared bounded-retry utility)', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withBoundedRetry(fn, { isRetryable: () => true, backoffMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure and succeeds on the next attempt', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce('ok');
    const result = await withBoundedRetry(fn, { isRetryable: () => true, backoffMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('never retries when isRetryable returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permanent'));
    await expect(withBoundedRetry(fn, { isRetryable: () => false, backoffMs: 1 })).rejects.toThrow('permanent');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts on a persistent retryable failure — never infinite', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(withBoundedRetry(fn, { isRetryable: () => true, maxAttempts: 3, backoffMs: 1 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('passes the current attempt number to the function', async () => {
    const attempts: number[] = [];
    const fn = vi.fn().mockImplementation(async (attempt: number) => {
      attempts.push(attempt);
      if (attempt < 3) throw new Error('retry me');
      return 'done';
    });
    const result = await withBoundedRetry(fn, { isRetryable: () => true, maxAttempts: 3, backoffMs: 1 });
    expect(result).toBe('done');
    expect(attempts).toEqual([1, 2, 3]);
  });
});
