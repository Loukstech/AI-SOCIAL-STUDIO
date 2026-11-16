import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CustomDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasAtLeast, type OrganizationRole } from '@ass/shared';
import { ENV, type Env } from '../config/env.js';
import { Db } from '../common/validation.js';
import { verifyToken, tokenFingerprint } from './crypto.js';
import type { AuthedRequest } from './auth.types.js';

const MIN_ROLE_KEY = 'minRole';
const ONLY_ROLES_KEY = 'onlyRoles';

/** Décorateur : rôle minimal requis sur une route d'organisation. */
export const MinRole = (role: OrganizationRole): CustomDecorator<string> =>
  SetMetadata(MIN_ROLE_KEY, role);

/**
 * Décorateur : ensemble **explicite** de rôles autorisés.
 *
 * La hiérarchie linéaire ne suffit pas pour la validation client (§14) : un
 * client doit pouvoir approuver un contenu, un éditeur ne doit pas pouvoir
 * approuver le sien. Aucun rang ne satisfait ces deux contraintes à la fois,
 * d'où cette liste nommée plutôt qu'un seuil.
 */
export const OnlyRoles = (...roles: OrganizationRole[]): CustomDecorator<string> =>
  SetMetadata(ONLY_ROLES_KEY, roles);

/**
 * Vérifie le jeton, la session active en base, l'organisation demandée
 * (en-tête `X-Organization-Id`) et les droits RBAC.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(Db) private readonly db: Db,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Jeton d’authentification manquant');
    }
    if (!this.env.AUTH_SECRET) {
      throw new UnauthorizedException('AUTH_SECRET non configuré');
    }

    const token = header.slice(7);
    const payload = verifyToken(token, this.env.AUTH_SECRET);
    if (!payload) throw new UnauthorizedException('Jeton invalide ou expiré');

    const session = await this.db.client.session.findUnique({
      where: { tokenHash: tokenFingerprint(token) },
      include: { user: true },
    });
    if (!session || session.userId !== payload.sub || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session expirée');
    }
    if (session.user.deletedAt) throw new UnauthorizedException('Compte désactivé');

    const organizationId = request.header('x-organization-id');
    const minRole =
      this.reflector.getAllAndOverride<OrganizationRole | undefined>(MIN_ROLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'VIEWER';
    const onlyRoles = this.reflector.getAllAndOverride<OrganizationRole[] | undefined>(
      ONLY_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (organizationId) {
      const member = await this.db.client.member.findUnique({
        where: { userId_organizationId: { userId: payload.sub, organizationId } },
      });
      if (!member) throw new ForbiddenException('Accès refusé à cette organisation');
      const role = member.role as OrganizationRole;
      if (!hasAtLeast(role, minRole)) {
        throw new ForbiddenException(`Rôle ${minRole} requis`);
      }
      if (onlyRoles && !onlyRoles.includes(role)) {
        throw new ForbiddenException(`Réservé aux rôles : ${onlyRoles.join(', ')}`);
      }
      request.auth = {
        userId: payload.sub,
        email: session.user.email,
        sessionId: session.id,
        organizationId,
        role: member.role,
      };
      return true;
    }

    // Les routes sans organisation (profil, liste des organisations) gardent un
    // contexte minimal ; l'organisation active sera résolue par le contrôleur.
    request.auth = {
      userId: payload.sub,
      email: session.user.email,
      sessionId: session.id,
      organizationId: '',
      role: 'VIEWER',
    };
    return true;
  }
}
