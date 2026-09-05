import { describe, expect, it } from 'vitest';
import { createResendEmailSender } from './auth/resend-email-sender.js';

/**
 * BUILD 22 Phase 10 (Live Email Smoke Test) — exercises the real Resend
 * vendor over the network. Deliberately NOT part of normal CI, mirroring
 * `live-provider-smoke.test.ts`'s exact gating pattern:
 *
 * - The master switch is `RUN_LIVE_EMAIL_SMOKE_TEST=true`. Without it, this
 *   whole suite is skipped — `npm test` never makes a network call and
 *   never requires a credential to pass.
 * - Also requires `RESEND_API_KEY`, `EMAIL_FROM` (a real verified sender
 *   identity), and `EMAIL_TEST_RECIPIENT` (a real, controlled test
 *   recipient — never a live user's address) all set; missing any one
 *   skips this suite individually, reported as SKIPPED, never PASS.
 * - No key is ever logged, asserted into a snapshot, or included in any
 *   error message this test prints — only the vendor's real response shape
 *   (status, message id) is asserted/printed.
 *
 * To run for real:
 *   RUN_LIVE_EMAIL_SMOKE_TEST=true RESEND_API_KEY=... EMAIL_FROM=you@yourdomain.com EMAIL_TEST_RECIPIENT=you+test@yourdomain.com \
 *     npx vitest run apps/api/src/live-email-smoke.test.ts
 */
const LIVE_EMAIL_SMOKE_TEST_ENABLED =
  process.env['RUN_LIVE_EMAIL_SMOKE_TEST'] === 'true' &&
  Boolean(process.env['RESEND_API_KEY']) &&
  Boolean(process.env['EMAIL_FROM']) &&
  Boolean(process.env['EMAIL_TEST_RECIPIENT']);

describe.skipIf(!LIVE_EMAIL_SMOKE_TEST_ENABLED)('Live email vendor smoke test (BUILD 22 Phase 10, opt-in only)', () => {
  it('sends one real, controlled test email via Resend and validates the real provider response', async () => {
    const sender = createResendEmailSender({
      apiKey: process.env['RESEND_API_KEY'],
      from: process.env['EMAIL_FROM']!,
    });

    const result = await sender.send({
      to: process.env['EMAIL_TEST_RECIPIENT']!,
      subject: 'AI Architectural Visualization Studio — BUILD 22 live smoke test',
      body: 'This is a real, controlled test email sent by the BUILD 22 live email smoke test. No action needed.',
      idempotencyKey: `build-22-live-smoke-${Date.now()}`,
    });

    expect(result.status).toBe('sent');
    expect(typeof result.providerMessageId).toBe('string');
    expect(result.providerMessageId!.length).toBeGreaterThan(0);

    // Safe to print: a provider message id is not a secret (same policy as
    // live-provider-smoke.test.ts never printing the API key itself).
    console.log(`Live email smoke test sent — provider message id: ${result.providerMessageId}`);
  }, 30_000);

  it('a real invalid credential is rejected by the vendor as an authentication failure, not silently accepted', async () => {
    const sender = createResendEmailSender({ apiKey: 're_invalid_test_key_00000000', from: process.env['EMAIL_FROM']! });
    await expect(
      sender.send({
        to: process.env['EMAIL_TEST_RECIPIENT']!,
        subject: 'BUILD 22 live smoke test — should be rejected',
        body: 'This send should fail authentication and never actually deliver.',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_PROVIDER_ERROR', providerCode: 'PROVIDER_AUTH_FAILED' });
  }, 30_000);
});
