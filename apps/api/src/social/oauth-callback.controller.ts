import { Controller, Get, Inject, Query, Redirect } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { OAuthService } from './oauth.service.js';

/**
 * Retour du fournisseur OAuth (§9).
 *
 * Cette route est **volontairement publique** : le navigateur y arrive par une
 * redirection du fournisseur, sans en-tête `Authorization`. La sécurité ne
 * repose donc pas sur la session mais sur l'état signé `state`, vérifié par
 * `OAuthService.handleCallback` (signature HMAC, expiration, organisation).
 *
 * La réponse est toujours une redirection vers l'interface : l'utilisateur est
 * dans un navigateur, un corps JSON d'erreur ne lui apprendrait rien.
 */
@Controller('social-accounts')
export class OAuthCallbackController {
  constructor(
    @Inject(OAuthService) private readonly oauth: OAuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * `@Redirect()` active la redirection : sans lui, Nest sérialiserait l'objet
   * de retour en JSON. L'URL et le code sont fournis à l'exécution, l'argument
   * vide n'est donc qu'un gabarit jamais utilisé.
   */
  @Get('oauth/callback')
  @Redirect()
  async callback(
    @Query() query: Record<string, string | undefined>,
  ): Promise<{ url: string; statusCode: number }> {
    try {
      const result = await this.oauth.handleCallback(query);
      return { url: this.redirect({ connected: result.platform }), statusCode: 302 };
    } catch (error) {
      return { url: this.redirect({ error: describe(error) }), statusCode: 302 };
    }
  }

  private redirect(params: Record<string, string>): string {
    // Retour sur la racine de l'application : l'interface est une SPA sans
    // routage par chemin, une URL profonde tomberait sur une page inexistante.
    const url = new URL(this.env.WEB_APP_URL);
    for (const [key, value] of Object.entries(params)) {
      // Le message est réaffiché tel quel par l'interface : on le borne.
      url.searchParams.set(key, sanitize(value));
    }
    return url.toString();
  }
}

/** Retire les caractères de contrôle et borne la longueur du message. */
function sanitize(value: string): string {
  const kept = [...value]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
  return kept.trim().slice(0, 300);
}

/** Message d'erreur lisible, sans fuite de détail interne. */
function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Connexion interrompue : réessayez depuis l’application.';
}
