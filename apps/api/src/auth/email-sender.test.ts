import { describe, expect, it } from 'vitest';
import { DomainError } from '@avs/shared';
import { InMemoryEmailSender, validateEmailMessage } from './email-sender.js';

describe('validateEmailMessage (BUILD 22 shared email-message validation)', () => {
  const valid = { to: 'user@example.com', subject: 'Hello', body: 'A real message.' };

  it('accepts a valid minimal message', () => {
    expect(() => validateEmailMessage(valid)).not.toThrow();
  });

  it('rejects an invalid recipient address', () => {
    expect(() => validateEmailMessage({ ...valid, to: 'not-an-email' })).toThrow(DomainError);
  });

  it('rejects an empty subject', () => {
    expect(() => validateEmailMessage({ ...valid, subject: '' })).toThrow(DomainError);
  });

  it('rejects a subject over 200 characters', () => {
    expect(() => validateEmailMessage({ ...valid, subject: 'x'.repeat(201) })).toThrow(DomainError);
  });

  it('rejects an empty body', () => {
    expect(() => validateEmailMessage({ ...valid, body: '' })).toThrow(DomainError);
  });

  it('rejects a body over 100,000 characters', () => {
    expect(() => validateEmailMessage({ ...valid, body: 'x'.repeat(100_001) })).toThrow(DomainError);
  });

  it('accepts an optional real html field and rejects an invalid replyTo', () => {
    expect(() => validateEmailMessage({ ...valid, html: '<p>Hi</p>' })).not.toThrow();
    expect(() => validateEmailMessage({ ...valid, replyTo: 'not-an-email' })).toThrow(DomainError);
  });

  it('throws a VALIDATION_ERROR DomainError, never retryable', () => {
    try {
      validateEmailMessage({ ...valid, to: 'bad' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('VALIDATION_ERROR');
      expect((error as DomainError).retryable).toBe(false);
    }
  });
});

describe('InMemoryEmailSender (BUILD 19/22)', () => {
  it('records a sent message and returns a real EmailSendResult', async () => {
    const sender = new InMemoryEmailSender();
    const result = await sender.send({ to: 'user@example.com', subject: 'Hi', body: 'Hello there.' });
    expect(result).toEqual({ status: 'sent' });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({ to: 'user@example.com', subject: 'Hi', body: 'Hello there.' });
  });

  it('records an optional html field when supplied', async () => {
    const sender = new InMemoryEmailSender();
    await sender.send({ to: 'user@example.com', subject: 'Hi', body: 'text', html: '<p>text</p>' });
    expect(sender.sent[0]?.html).toBe('<p>text</p>');
  });

  it('validates before recording — an invalid message is never added to .sent', async () => {
    const sender = new InMemoryEmailSender();
    await expect(sender.send({ to: 'not-an-email', subject: 'Hi', body: 'x' })).rejects.toThrow(DomainError);
    expect(sender.sent).toHaveLength(0);
  });
});
