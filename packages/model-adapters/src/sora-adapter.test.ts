import { describe, expect, it } from 'vitest';
import { SoraAdapter } from './sora-adapter.js';

const request = {
  requestId: 'req-1',
  promptText: 'Slow dolly-in on the villa facade.',
  sourceImage: { data: new Uint8Array([1, 2, 3]), contentType: 'image/png' },
  aspectRatio: '16:9',
  resolution: '2K',
  durationSeconds: 6,
};

describe('SoraAdapter — no durable integration exists (BUILD 16 finding), never faked', () => {
  it('declares the contract but never simulates a real submission', async () => {
    const adapter = new SoraAdapter();
    expect(typeof adapter.id).toBe('string');
    expect(adapter.capabilities()).toBeDefined();
    await expect(adapter.submit(request)).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
      message: expect.stringContaining('2026-09-24'),
    });
  });

  it('never simulates a poll result either — there is no real operation to poll', async () => {
    const adapter = new SoraAdapter();
    await expect(adapter.pollStatus({ operationName: 'x' })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('validates real, non-empty input as valid — never rejects a well-formed request', () => {
    const adapter = new SoraAdapter();
    expect(adapter.validate(request)).toEqual({ valid: true, errors: [] });
    expect(adapter.validate({ ...request, promptText: '' }).valid).toBe(false);
  });
});
