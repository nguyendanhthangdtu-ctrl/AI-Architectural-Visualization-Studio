import { describe, expect, it } from 'vitest';
import { InMemoryJobQueue } from './job-queue.js';

describe('InMemoryJobQueue', () => {
  it('is idempotent: the same idempotency key returns the same job', async () => {
    const queue = new InMemoryJobQueue();
    const first = await queue.enqueue({ idempotencyKey: 'key-1' });
    const second = await queue.enqueue({ idempotencyKey: 'key-1' });
    expect(second.id).toBe(first.id);
  });

  it('creates distinct jobs for distinct idempotency keys', async () => {
    const queue = new InMemoryJobQueue();
    const first = await queue.enqueue({ idempotencyKey: 'key-1' });
    const second = await queue.enqueue({ idempotencyKey: 'key-2' });
    expect(second.id).not.toBe(first.id);
  });
});
