/**
 * Transport e-mail (§15).
 *
 * Le cahier des charges demande des notifications « internes et e-mail ».
 * Aucun fournisseur transactionnel n'est branché sur ce déploiement : plutôt
 * que d'écrire un envoi factice, le transport par défaut **refuse d'envoyer**
 * et le dit. Le statut enregistré est alors `NO_PROVIDER`, distinct de
 * `FAILED` : il n'y a pas eu de tentative, donc pas d'échec.
 *
 * Brancher un vrai fournisseur consiste à fournir une implémentation de
 * `MailTransport` via le jeton d'injection `MAIL_TRANSPORT` — le service de
 * notifications n'a pas à changer. Les tests injectent d'ailleurs un transport
 * simulé pour vérifier le chemin `SENT` sans jamais prétendre qu'il existe en
 * production.
 */
import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type MailResult =
  { ok: true } | { ok: false; code: 'NO_PROVIDER' | 'TRANSPORT_ERROR'; message: string };

export interface MailTransport {
  /** Nature du transport, pour l'affichage et les tests. */
  readonly kind: 'NONE' | 'SMTP' | 'API';
  send(message: MailMessage): Promise<MailResult>;
  /** Ce que le déploiement peut réellement faire. */
  describe(): { available: boolean; reason: string | null };
}

/** Jeton d'injection du transport, remplaçable par un fournisseur réel. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export const NO_PROVIDER_REASON =
  'Aucun transport e-mail transactionnel n’est configuré sur ce déploiement : les notifications restent internes. La préférence e-mail est enregistrée et sera honorée dès qu’un fournisseur sera branché.';

/**
 * Transport inerte : il ne prétend rien.
 *
 * `available: false` et un motif explicite, pour que l'interface puisse dire
 * « l'e-mail n'est pas configuré » au lieu d'afficher un canal qui ne part
 * jamais.
 */
export const noopMailTransport: MailTransport = {
  kind: 'NONE',
  async send() {
    return { ok: false, code: 'NO_PROVIDER', message: NO_PROVIDER_REASON };
  },
  describe() {
    return { available: false, reason: NO_PROVIDER_REASON };
  },
};

/**
 * Transport Resend via son API HTTP. Sans clé, on renvoie le transport inerte :
 * aucune tentative d'envoi n'est simulée (§15).
 */
export function createResendTransport(config: { apiKey?: string; from?: string }): MailTransport {
  if (!config.apiKey) return noopMailTransport;

  const from = config.from || 'AI Social Studio <onboarding@resend.dev>';

  return {
    kind: 'API',
    async send(message: MailMessage): Promise<MailResult> {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
          }),
          signal: AbortSignal.timeout(10_000),
        });

        if (response.ok) return { ok: true };

        let detail = await response.text();
        try {
          const parsed = JSON.parse(detail) as { message?: string };
          detail = parsed.message ?? detail;
        } catch {
          // Le corps n'est pas toujours JSON (passerelle, 502…).
        }
        return {
          ok: false,
          code: 'TRANSPORT_ERROR',
          message: `Resend ${response.status} : ${detail.slice(0, 300)}`,
        };
      } catch (cause) {
        return {
          ok: false,
          code: 'TRANSPORT_ERROR',
          message: `Transport e-mail indisponible : ${
            cause instanceof Error ? cause.message : 'erreur inconnue'
          }`,
        };
      }
    },
    describe() {
      return { available: true, reason: null };
    },
  };
}

/**
 * Transport SMTP générique (Hostinger, ou tout fournisseur avec SMTP).
 * `secure: true` correspond au port 465 ; 587 avec STARTTLS reste `false`.
 */
export function createSmtpTransport(config: {
  host?: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from?: string;
}): MailTransport {
  if (!config.host || !config.user || !config.password) return noopMailTransport;

  const from = config.from || config.user;
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });

  return {
    kind: 'SMTP',
    async send(message: MailMessage): Promise<MailResult> {
      try {
        await transporter.sendMail({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
        return { ok: true };
      } catch (cause) {
        return {
          ok: false,
          code: 'TRANSPORT_ERROR',
          message: `SMTP indisponible : ${
            cause instanceof Error ? cause.message : 'erreur inconnue'
          }`,
        };
      }
    },
    describe() {
      return { available: true, reason: null };
    },
  };
}
