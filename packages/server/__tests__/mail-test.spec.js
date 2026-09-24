import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nodemailer = require('nodemailer');
const smtp = require('../src/service/smtp-settings.js');

let send,
 sendMail,
 close;
beforeEach(() => {
  delete require.cache[require.resolve('../src/service/mail-test.js')];
  send = require('../src/service/mail-test.js').send;
  sendMail = vi.fn().mockResolvedValue({ accepted: ['test@example.com'] });
  close = vi.fn();
  vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail, close });
  vi.spyOn(smtp, 'transport').mockReturnValue({ host: 'smtp.example.com', secure: true });
  vi.spyOn(smtp, 'from').mockReturnValue({ address: 'sender@example.com' });
});
afterEach(() => vi.restoreAllMocks());
describe('test mail', () => {
  it('sends only to the explicit recipient and throttles repeat attempts', async () => {
    await expect(send({ to: 'test@example.com' })).resolves.toStrictEqual({ sent: true });
    expect(sendMail.mock.calls[0][0].to).toBe('test@example.com');
    await expect(send({ to: 'test@example.com' })).resolves.toStrictEqual({ sent: false, reason: 'rate' });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('renders the current template with sample data without saving it', async () => {
    const save = vi.spyOn(require('../src/service/mail-templates.js'), 'save');
    await send({ to: 'test@example.com', template: { language: 'en-us', kind: 'reply', subject: '{{self.nick}}', body: '{{parent.comment | safe}}' } });
    expect(sendMail.mock.calls[0][0].subject).toContain('Example commenter');
    expect(sendMail.mock.calls[0][0].html).toContain('original comment');
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects multiple recipients, injected headers, and malformed templates', async () => {
    for (const to of ['a@example.com,b@example.com', 'a@example.com\r\nBcc:b@example.com', 'bad']) {
      expect((await send({ to })).reason).toBe('recipient');
    }
    expect((await send({ to: 'test@example.com', template: {} })).reason).toBe('template');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('does not send when SMTP is disabled', async () => {
    smtp.transport.mockReturnValue(null);
    expect((await send({ to: 'test@example.com' })).reason).toBe('disabled');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('redacts provider errors and closes the transport', async () => {
    sendMail.mockRejectedValue(Object.assign(new Error('secret credential'), { code: 'EAUTH' }));
    await expect(send({ to: 'test@example.com' })).resolves.toStrictEqual({ sent: false, reason: 'auth' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected recipient instead of claiming delivery', async () => {
    sendMail.mockResolvedValue({ accepted: [], rejected: ['test@example.com'] });
    expect((await send({ to: 'test@example.com' })).reason).toBe('rejected');
  });
});
