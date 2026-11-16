import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.types.js';

/**
 * Administration de la plateforme (§17).
 *
 * Ce droit est indépendant des rôles d'organisation : un OWNER n'est pas
 * admin de la plateforme, et un super admin n'a pas besoin d'être membre de
 * l'organisation qu'il inspecte.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (!request.auth?.isSuperAdmin) {
      throw new ForbiddenException('Administration plateforme réservée');
    }
    return true;
  }
}
