import {
  classifyProviderHttpStatus,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  DomainError,
  fetchWithTimeout,
  ProviderTimeoutError,
  sanitizeProviderErrorBody,
  withBoundedRetry,
} from '@avs/shared';
import type { EmailMessage, EmailSendResult, EmailSender } from './email-sender.js';
import { validateEmailMessage } from './email-sender.js';

/**
 * BUILD 22 (Real Email Vendor Integration) — Resend, validated against
 * current official documentation (accessed 2026-09-05):
 * https://resend.com/docs/api-reference/emails/send-email,
 * https://resend.com/docs/api-reference/errors. A single-endpoint JSON REST
 * API (`POST /emails`, Bearer auth) — no vendor SDK needed, matching this
 * project's existing "raw fetch, no new dependency" pattern already used by
 * every AI provider adapter (docs/10). Chosen over SMTP/SES/SendGrid
 * because it needs zero additional infrastructure (no SMTP relay, no AWS
 * account) and its API shape is the closest real match to the adapters
 * already in this codebase — a real, deliberate first vendor, not the only
 * one this boundary could ever support (see `EmailSender`'s own doc
 * comment — a second vendor would implement the exact same interface).
 *
 * IMPORTANT: no RESEND_API_KEY was available at implementation time — this
 * has been validated against current documentation but NOT exercised
 * against the real API. Treat live behavior as unverified until a key is
 * supplied and `live-email-smoke.test.ts` is actually run once, per
 * CLAUDE.md rule 13 (same honest disclaimer every other adapter in this
 * codebase already carries).
 */
const RESEND_API_URL = 'https://api.resend.com/emails';

export interface ResendEmailSenderConfig {
  apiKey: string | undefined;
  /** The verified sender identity Resend will send as — required whenever `apiKey` is set. */
  from: string;
  /** Default Reply-To; a per-message `EmailMessage.replyTo` overrides this. */
  replyTo?: string;
  /** Injectable for testing — defaults to the global fetch. */
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  /** Bounded retry — BUILD 22 Phase 7/9: only retries a classified-retryable failure, never auth/validation/permanent rejections. */
  maxAttempts?: number;
  /** Base backoff between retries, in ms; attempt N waits `retryBackoffMs * N`. Kept tiny in tests, real in production. */
  retryBackoffMs?: number;
}

interface ResendSuccessResponse {
  id?: string;
}

function classifyResendError(status: number, message: string): DomainError {
  const { category, retryable } = classifyProviderHttpStatus(status);
  return new DomainError({
    code: 'EMAIL_PROVIDER_ERROR',
    message: `Resend API error (${status}): ${sanitizeProviderErrorBody(message)}`,
    retryable,
    providerCode: category,
  });
}

export function createResendEmailSender(config: ResendEmailSenderConfig): EmailSender {
  const fetchFn = config.fetchFn ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const maxAttempts = config.maxAttempts ?? 3;
  const retryBackoffMs = config.retryBackoffMs ?? 200;

  return {
    async send(email: EmailMessage): Promise<EmailSendResult> {
      validateEmailMessage(email);

      if (!config.apiKey) {
        throw new DomainError({
          code: 'PROVIDER_NOT_CONFIGURED',
          message: 'RESEND_API_KEY is not configured — set it (and EMAIL_FROM) in .env to enable real email delivery (docs/16).',
          retryable: false,
        });
      }

      const requestBody = {
        from: config.from,
        to: [email.to],
        subject: email.subject,
        text: email.body,
        ...(email.html !== undefined ? { html: email.html } : {}),
        ...(email.replyTo ?? config.replyTo ? { reply_to: email.replyTo ?? config.replyTo } : {}),
      };

      // BUILD 23 — the retry loop itself now lives in @avs/shared's
      // withBoundedRetry (extracted from this exact loop, previously
      // inline here) so image-generation adapters can reuse the identical,
      // already-tested mechanism instead of a second copy (CLAUDE.md rule 9).
      return withBoundedRetry(
        async () => {
          try {
            const res = await fetchWithTimeout(
              fetchFn,
              RESEND_API_URL,
              {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  authorization: `Bearer ${config.apiKey}`,
                  // Real, documented Resend header — lets the vendor itself dedupe a retried
                  // request server-side, so this loop's own retry (or a future caller's) can
                  // never result in two delivered emails for the same logical send.
                  ...(email.idempotencyKey ? { 'idempotency-key': email.idempotencyKey } : {}),
                },
                body: JSON.stringify(requestBody),
              },
              timeoutMs,
            );

            if (!res.ok) {
              const bodyText = await res.text().catch(() => '');
              throw classifyResendError(res.status, bodyText || res.statusText);
            }

            const responseJson = (await res.json()) as ResendSuccessResponse;
            return { status: 'sent' as const, ...(responseJson.id ? { providerMessageId: responseJson.id } : {}) };
          } catch (error) {
            if (error instanceof ProviderTimeoutError) {
              throw new DomainError({ code: 'EMAIL_PROVIDER_ERROR', message: `Resend API request timed out: ${error.message}`, retryable: true, providerCode: 'PROVIDER_TIMEOUT' });
            }
            if (error instanceof DomainError) throw error;
            throw new DomainError({ code: 'EMAIL_PROVIDER_ERROR', message: error instanceof Error ? error.message : String(error), retryable: false, providerCode: 'INTERNAL_ERROR' });
          }
        },
        { maxAttempts, backoffMs: retryBackoffMs, isRetryable: (error) => error instanceof DomainError && error.retryable },
      );
    },
  };
}
