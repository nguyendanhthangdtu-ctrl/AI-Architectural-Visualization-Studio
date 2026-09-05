import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '@avs/shared';
import { createResendEmailSender } from './resend-email-sender.js';

const VALID_MESSAGE = { to: 'user@example.com', subject: 'Reset your password', body: 'Real body text.' };

describe('createResendEmailSender (BUILD 22 real email vendor adapter)', () => {
  it('sends a real request with the configured sender, auth header, and returns the provider message id', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'msg-123' }) });
    const sender = createResendEmailSender({ apiKey: 'real-key', from: 'noreply@example.com', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await sender.send(VALID_MESSAGE);

    expect(result).toEqual({ status: 'sent', providerMessageId: 'msg-123' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer real-key');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: 'noreply@example.com', to: ['user@example.com'], subject: 'Reset your password', text: 'Real body text.' });
  });

  it('sends the configured/per-message replyTo as reply_to, per-message taking precedence', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'msg-1' }) });
    const sender = createResendEmailSender({ apiKey: 'k', from: 'noreply@example.com', replyTo: 'default@example.com', fetchFn: fetchFn as unknown as typeof fetch });
    await sender.send({ ...VALID_MESSAGE, replyTo: 'override@example.com' });
    const body = JSON.parse(fetchFn.mock.calls[0]![1].body);
    expect(body.reply_to).toBe('override@example.com');
  });

  it('sends the idempotencyKey as a real Idempotency-Key header when supplied', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'msg-1' }) });
    const sender = createResendEmailSender({ apiKey: 'k', from: 'noreply@example.com', fetchFn: fetchFn as unknown as typeof fetch });
    await sender.send({ ...VALID_MESSAGE, idempotencyKey: 'stable-key-1' });
    expect(fetchFn.mock.calls[0]![1].headers['idempotency-key']).toBe('stable-key-1');
  });

  it('validates the message before ever calling fetch', async () => {
    const fetchFn = vi.fn();
    const sender = createResendEmailSender({ apiKey: 'k', from: 'noreply@example.com', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(sender.send({ to: 'not-an-email', subject: 'x', body: 'y' })).rejects.toThrow(DomainError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws PROVIDER_NOT_CONFIGURED without ever calling fetch when no API key is set', async () => {
    const fetchFn = vi.fn();
    const sender = createResendEmailSender({ apiKey: undefined, from: 'noreply@example.com', fetchFn: fetchFn as unknown as typeof fetch });
    await expect(sender.send(VALID_MESSAGE)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('classifies a 401 as a non-retryable PROVIDER_AUTH_FAILED and does not retry', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'invalid_api_key' });
    const sender = createResendEmailSender({ apiKey: 'bad-key', from: 'noreply@example.com', fetchFn: fetchFn as unknown as typeof fetch, retryBackoffMs: 1 });
    await expect(sender.send(VALID_MESSAGE)).rejects.toMatchObject({ code: 'EMAIL_PROVIDER_ERROR', providerCode: 'PROVIDER_AUTH_FAILED', retryable: false });
    expect(fetchFn).toHaveBeenCalledTimes(1); // no retry on a permanent auth failure
  });

  it('classifies a 422 as a non-retryable PROVIDER_INVALID_REQUEST and does not retry', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 422, statusText: 'Unprocessable Entity', text: async () => 'validation_error' });
    const sender = createResendEmailSender({ apiKey: 'k', from: 'noreply@example.com', fetchFn: fetchFn as unknown as typeof fetch, retryBackoffMs: 1 });
    await expect(sender.send(VALID_MESSAGE)).rejects.toMatchObject({ providerCode: 'PROVIDER_INVALID_REQUEST', retryable: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 rate-limit response with bounded backoff, then succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'rate_limit_exceeded' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'msg-retry' }) });
    const sender = createResendEmailSender({ apiKey: 'k', from: 'noreply@example.com', fetchFn: fetchFn as unknown as typeof fetch, retryBackoffMs: 1 });

    const result = await sender.send(VALID_MESSAGE);

    expect(result).toEqual({ status: 'sent', providerMessageId: 'msg-retry' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries a real request timeout, then succeeds', async () => {
    let attempt = 0;
    const fetchFn = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      attempt += 1;
      if (attempt === 1) {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
        });
      }
      return { ok: true, status: 200, json: async () => ({ id: 'msg-after-timeout' }) };
    });
    const sender = createResendEmailSender({ apiKey: 'k', from: 'noreply@example.com', fetchFn: fetchFn as unknown as typeof fetch, timeoutMs: 10, retryBackoffMs: 1 });

    const result = await sender.send(VALID_MESSAGE);

    expect(result).toEqual({ status: 'sent', providerMessageId: 'msg-after-timeout' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts on a persistently retryable (5xx) failure', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable', text: async () => 'down' });
    const sender = createResendEmailSender({ apiKey: 'k', from: 'noreply@example.com', fetchFn: fetchFn as unknown as typeof fetch, maxAttempts: 3, retryBackoffMs: 1 });

    await expect(sender.send(VALID_MESSAGE)).rejects.toMatchObject({ providerCode: 'PROVIDER_UNAVAILABLE', retryable: true });
    expect(fetchFn).toHaveBeenCalledTimes(3); // bounded — never infinite
  });

  it('never leaks the API key in a thrown error message', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'invalid_api_key' });
    const sender = createResendEmailSender({ apiKey: 'super-secret-real-key-should-never-leak', from: 'noreply@example.com', fetchFn: fetchFn as unknown as typeof fetch, retryBackoffMs: 1 });
    try {
      await sender.send(VALID_MESSAGE);
      expect.unreachable();
    } catch (error) {
      expect((error as DomainError).message).not.toContain('super-secret-real-key-should-never-leak');
    }
  });

  it('never sends the raw email body/html as part of a thrown error', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request', text: async () => 'validation_error' });
    const sender = createResendEmailSender({ apiKey: 'k', from: 'noreply@example.com', fetchFn: fetchFn as unknown as typeof fetch, retryBackoffMs: 1 });
    try {
      await sender.send({ ...VALID_MESSAGE, body: 'a very sensitive reset token lives right here' });
      expect.unreachable();
    } catch (error) {
      expect((error as DomainError).message).not.toContain('a very sensitive reset token lives right here');
    }
  });
});
