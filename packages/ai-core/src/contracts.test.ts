import { describe, expect, it } from 'vitest';
import { aiQc } from './qc.js';

describe('ai-core contracts (Bootstrap stubs still pending their Build Gate)', () => {
  it('each still-pending module reports NOT_IMPLEMENTED with its owning Build Gate rather than silently succeeding', async () => {
    await expect(
      aiQc.evaluate({ sourceAssetUrl: 'u', normalizedRequest: {} as never, outputAssetUrl: 'u' }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', message: expect.stringContaining('BUILD 17') });
  });
});
