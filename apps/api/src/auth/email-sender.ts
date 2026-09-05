/**
 * BUILD 19 (Account Recovery) — a real, minimal delivery boundary for the
 * one email this app sends (a password reset link/token), same "concrete
 * engine deferred, contract real now" pattern as `JobQueue`/`AssetStore`
 * before their own concrete vendors were chosen (docs/03 §13): a real
 * SMTP/SES/SendGrid integration is a genuine future vendor decision, not
 * fabricated here (CLAUDE.md rule 7) — no email is ever actually delivered
 * by `InMemoryEmailSender` below, and this app is honest about that rather
 * than pretending a mail provider exists.
 */
export interface SentEmail {
  to: string;
  subject: string;
  body: string;
  sentAt: string;
}

export interface EmailSender {
  send(email: { to: string; subject: string; body: string }): Promise<void>;
}

/**
 * Dev/test reference implementation — records what would have been sent so
 * a test can inspect it directly (the only way to drive the real reset flow
 * end-to-end without a configured mail provider), never delivers anything.
 * Real production use requires wiring a real `EmailSender` behind this same
 * interface once a mail vendor is chosen — not fixed here.
 */
export class InMemoryEmailSender implements EmailSender {
  readonly sent: SentEmail[] = [];

  async send(email: { to: string; subject: string; body: string }): Promise<void> {
    this.sent.push({ ...email, sentAt: new Date().toISOString() });
  }
}
