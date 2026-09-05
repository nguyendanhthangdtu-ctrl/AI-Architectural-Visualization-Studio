import { z } from '@avs/shared';
import { DomainError } from '@avs/shared';

/**
 * BUILD 19 (Account Recovery) — a real, minimal delivery boundary for the
 * one email this app sends (a password reset link/token), same "concrete
 * engine deferred, contract real now" pattern as `JobQueue`/`AssetStore`
 * before their own concrete vendors were chosen (docs/03 §13).
 *
 * BUILD 22 (Real Email Vendor Integration) — extends this same interface
 * (never replaces it) so a real vendor adapter (`resend-email-sender.ts`)
 * can implement it alongside `InMemoryEmailSender`: `html`/`replyTo` are now
 * real, optional fields a caller may supply; `idempotencyKey` lets a caller
 * hand the vendor a stable value so its own bounded retry (or a future
 * caller's retry) can never cause a duplicate delivery; `send()` now
 * resolves to a real `EmailSendResult` instead of `void`, so a caller CAN
 * inspect a provider message id when one exists — existing callers that
 * never inspected the old `void` return keep working unchanged.
 */
export interface SentEmail {
  to: string;
  subject: string;
  body: string;
  html?: string;
  sentAt: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  html?: string;
  replyTo?: string;
  /** BUILD 22 — a stable value (e.g. a hashed reset token id) a vendor adapter can use to dedupe retried sends. */
  idempotencyKey?: string;
}

export interface EmailSendResult {
  status: 'sent';
  /** The vendor's own message/request id, when it returns one — safe to log/store, never a secret. */
  providerMessageId?: string;
}

export interface EmailSender {
  send(email: EmailMessage): Promise<EmailSendResult>;
}

const emailMessageSchema = z.object({
  to: z.string().trim().email('to must be a valid email address'),
  subject: z.string().trim().min(1, 'subject must not be empty').max(200, 'subject must be at most 200 characters'),
  body: z.string().min(1, 'body must not be empty').max(100_000, 'body must be at most 100,000 characters'),
  html: z.string().max(200_000, 'html must be at most 200,000 characters').optional(),
  replyTo: z.string().trim().email('replyTo must be a valid email address').optional(),
  idempotencyKey: z.string().optional(),
});

/**
 * BUILD 22 — shared validation every `EmailSender` implementation runs
 * before doing anything vendor-specific (CLAUDE.md rule 9: never
 * duplicated per-adapter). Real recipient-format/subject/content/size
 * rules, not vendor-specific ones — a vendor's OWN rejection (e.g. a
 * suppressed address) is still classified separately by that adapter.
 */
export function validateEmailMessage(email: EmailMessage): void {
  const result = emailMessageSchema.safeParse(email);
  if (!result.success) {
    throw new DomainError({
      code: 'VALIDATION_ERROR',
      message: `Invalid email message: ${result.error.issues.map((i) => i.message).join('; ')}`,
      retryable: false,
    });
  }
}

/**
 * Dev/test reference implementation — records what would have been sent so
 * a test can inspect it directly (the only way to drive the real reset flow
 * end-to-end without a configured mail provider), never delivers anything.
 * Selected automatically whenever no real vendor is configured
 * (`app-context.ts`) — production use requires `EMAIL_PROVIDER`/a real
 * vendor credential, wiring a real `EmailSender` behind this same interface.
 */
export class InMemoryEmailSender implements EmailSender {
  readonly sent: SentEmail[] = [];

  async send(email: EmailMessage): Promise<EmailSendResult> {
    validateEmailMessage(email);
    this.sent.push({
      to: email.to,
      subject: email.subject,
      body: email.body,
      ...(email.html !== undefined ? { html: email.html } : {}),
      sentAt: new Date().toISOString(),
    });
    return { status: 'sent' };
  }
}
