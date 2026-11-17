import { afterEach, describe, expect, it, vi } from 'vitest';

const { sendMailMock, createTransportMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(),
  createTransportMock: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));

import { createSmtpTransport } from './mail.js';

const CONFIG = {
  host: 'smtp.hostinger.com',
  port: 587,
  secure: false,
  user: 'noreply@example.com',
  password: 'secret-de-test',
  from: 'AI Social Studio <noreply@example.com>',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('transport SMTP (Hostinger)', () => {
  it('reste inerte sans identifiants complets', async () => {
    const transport = createSmtpTransport({
      host: CONFIG.host,
      port: CONFIG.port,
      secure: false,
    });
    expect(transport.kind).toBe('NONE');
    expect(transport.describe().available).toBe(false);
    expect(createTransportMock).not.toHaveBeenCalled();
    const result = await transport.send({ to: 'x@example.com', subject: 's', text: 't' });
    expect(result.ok).toBe(false);
  });

  it('envoie avec STARTTLS et l’expéditeur configuré', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'test' });
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });

    const transport = createSmtpTransport(CONFIG);
    const result = await transport.send({
      to: 'invite@example.com',
      subject: 'Invitation',
      text: 'Bonjour',
    });

    expect(result).toEqual({ ok: true });
    expect(transport.kind).toBe('SMTP');
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.hostinger.com',
        port: 587,
        secure: false,
        auth: { user: CONFIG.user, pass: CONFIG.password },
      }),
    );
    expect(sendMailMock).toHaveBeenCalledWith({
      from: CONFIG.from,
      to: 'invite@example.com',
      subject: 'Invitation',
      text: 'Bonjour',
    });
  });

  it('transforme une panne SMTP en échec sans exposer le mot de passe', async () => {
    sendMailMock.mockRejectedValue(new Error('ECONNECTION'));
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });

    const transport = createSmtpTransport(CONFIG);
    const result = await transport.send({ to: 'x@example.com', subject: 's', text: 't' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TRANSPORT_ERROR');
      expect(result.message).toContain('SMTP indisponible');
      expect(result.message).not.toContain(CONFIG.password);
    }
  });
});
