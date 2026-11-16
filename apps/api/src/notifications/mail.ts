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
