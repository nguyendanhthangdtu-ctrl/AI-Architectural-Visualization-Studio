/**
 * Shared error envelope — docs/03_TECHNICAL_ARCHITECTURE.md §8.
 * Every AI action's failure reason (docs/02 UX rule) must derive from this envelope,
 * never a raw provider/database error passed through a boundary.
 */
export interface ErrorEnvelope {
  code: string;
  message: string;
  retryable: boolean;
  providerCode?: string;
  requestId?: string;
}

export class DomainError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly providerCode?: string;

  constructor(params: { code: string; message: string; retryable: boolean; providerCode?: string }) {
    super(params.message);
    this.name = 'DomainError';
    this.code = params.code;
    this.retryable = params.retryable;
    if (params.providerCode !== undefined) {
      this.providerCode = params.providerCode;
    }
  }

  toEnvelope(requestId?: string): ErrorEnvelope {
    const envelope: ErrorEnvelope = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.providerCode !== undefined) {
      envelope.providerCode = this.providerCode;
    }
    if (requestId !== undefined) {
      envelope.requestId = requestId;
    }
    return envelope;
  }
}
