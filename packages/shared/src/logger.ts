/**
 * Structured logging boundary — docs/03 §9/§11 ("structured logging must
 * redact known secret field names; adapters never log raw provider payloads
 * containing keys"). Concrete log-shipping vendor is a later infra decision;
 * this is the interface every package logs through so that decision doesn't
 * ripple through the codebase.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const DEFAULT_REDACT_KEYS = ['apiKey', 'api_key', 'secret', 'token', 'password', 'credentials'];

function redact(
  context: Record<string, unknown> | undefined,
  redactKeys: readonly string[],
): Record<string, unknown> | undefined {
  if (!context) return context;
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    const shouldRedact = redactKeys.some((redactKey) => key.toLowerCase().includes(redactKey.toLowerCase()));
    redacted[key] = shouldRedact ? '[REDACTED]' : value;
  }
  return redacted;
}

export function createConsoleLogger(options: { redactKeys?: readonly string[] } = {}): Logger {
  const redactKeys = options.redactKeys ?? DEFAULT_REDACT_KEYS;
  const emit = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
    const entry = { level, message, ...(context ? { context: redact(context, redactKeys) } : {}) };
    console[level === 'debug' ? 'log' : level](JSON.stringify(entry));
  };
  return {
    debug: (message, context) => emit('debug', message, context),
    info: (message, context) => emit('info', message, context),
    warn: (message, context) => emit('warn', message, context),
    error: (message, context) => emit('error', message, context),
  };
}
