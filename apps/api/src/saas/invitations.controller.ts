import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  organizationRoleSchema,
  type AcceptInvitationInput,
  type AcceptedInvitation,
  type CreateInvitationInput,
  type CreatedInvitation,
  type Invitation,
} from '@ass/shared';
import { Db, ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { ENV, type Env } from '../config/env.js';
import { tokenFingerprint } from '../auth/crypto.js';
import { MAIL_TRANSPORT, noopMailTransport, type MailTransport } from '../notifications/mail.js';

/** Invitations d'une organisation (réservées aux administrateurs). */
@Controller('organizations/:organizationId/invitations')
@UseGuards(AuthGuard)
export class InvitationsController {
  private readonly logger = new Logger(InvitationsController.name);

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Optional() @Inject(MAIL_TRANSPORT) private readonly mail?: MailTransport,
  ) {}

  @Get()
  @MinRole('ADMIN')
  async list(
    @Req() request: AuthedRequest,
    @Param('organizationId') organizationId: string,
  ): Promise<Invitation[]> {
    this.assertActiveOrg(request, organizationId);
    const rows = await this.db.client.invitation.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toInvitation);
  }

  @Post()
  @MinRole('ADMIN')
  async create(
    @Req() request: AuthedRequest,
    @Param('organizationId') organizationId: string,
    @Body(new ZodPipe(createInvitationSchema)) body: CreateInvitationInput,
  ): Promise<CreatedInvitation> {
    this.assertActiveOrg(request, organizationId);
    const db = this.db.client;

    const existingUser = await db.user.findUnique({ where: { email: body.email } });
    if (existingUser) {
      const member = await db.member.findUnique({
        where: {
          userId_organizationId: { userId: existingUser.id, organizationId },
        },
      });
      if (member) throw new ConflictException('Cette personne est déjà membre de l’organisation');
    }

    // Une seule invitation active par adresse : les précédentes sont révoquées.
    await db.invitation.updateMany({
      where: { organizationId, email: body.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.env.INVITATION_TTL_HOURS * 3_600_000);
    const invitation = await db.invitation.create({
      data: {
        organizationId,
        email: body.email,
        role: body.role,
        tokenHash: tokenFingerprint(token),
        invitedById: request.auth!.userId,
        expiresAt,
      },
    });

    const acceptUrl = `${this.env.WEB_APP_URL}/?invitation=${encodeURIComponent(token)}`;
    const emailResult = await this.sendInvitationEmail(body.email, acceptUrl, expiresAt);

    await db.auditLog.create({
      data: {
        organizationId,
        actorId: request.auth!.userId,
        action: 'invitation.created',
        targetType: 'invitation',
        targetId: invitation.id,
        metadata: { email: body.email, role: body.role, emailStatus: emailResult },
      },
    });

    return {
      ...toInvitation(invitation),
      token,
      acceptUrl,
    };
  }

  /** Envoi best-effort : une panne du transport ne bloque pas l'invitation. */
  private async sendInvitationEmail(
    to: string,
    acceptUrl: string,
    expiresAt: Date,
  ): Promise<string> {
    if (this.env.NODE_ENV === 'test' || to.toLowerCase().endsWith('.test')) {
      return 'SKIPPED_TEST_ADDRESS';
    }

    const transport = this.mail ?? noopMailTransport;
    if (!transport.describe().available) return 'NO_PROVIDER';

    let result;
    try {
      result = await transport.send({
        to,
        subject: 'Invitation à rejoindre AI Social Studio',
        text: [
          'Bonjour,',
          '',
          'Vous avez été invité à rejoindre AI Social Studio.',
          '',
          `Accepter l’invitation : ${acceptUrl}`,
          '',
          `Ce lien expire le ${expiresAt.toISOString()}.`,
        ].join('\n'),
      });
    } catch (cause) {
      this.logger.warn(`E-mail d’invitation non envoyé à ${to} : ${String(cause)}`);
      return 'TRANSPORT_ERROR';
    }

    if (!result.ok) {
      this.logger.warn(`E-mail d’invitation non envoyé à ${to} : ${result.message}`);
      return result.code;
    }
    return 'SENT';
  }

  @Delete(':invitationId')
  @HttpCode(204)
  @MinRole('ADMIN')
  async revoke(
    @Req() request: AuthedRequest,
    @Param('organizationId') organizationId: string,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    this.assertActiveOrg(request, organizationId);
    const { count } = await this.db.client.invitation.updateMany({
      where: { id: invitationId, organizationId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Invitation introuvable ou déjà traitée');
  }

  private assertActiveOrg(request: AuthedRequest, organizationId: string): void {
    if (request.auth!.organizationId !== organizationId) {
      throw new BadRequestException(
        "L'en-tête X-Organization-Id doit correspondre à l'organisation demandée",
      );
    }
  }
}

/** Acceptation d'une invitation : l'utilisateur connecté rejoint l'organisation. */
@Controller('invitations')
@UseGuards(AuthGuard)
export class InvitationAcceptanceController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Post('accept')
  @HttpCode(200)
  async accept(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
  ): Promise<AcceptedInvitation> {
    const db = this.db.client;
    const invitation = await db.invitation.findUnique({
      where: { tokenHash: tokenFingerprint(body.token) },
      include: { organization: true },
    });
    if (!invitation) throw new NotFoundException('Invitation introuvable');
    if (invitation.revokedAt) throw new BadRequestException('Cette invitation a été révoquée');
    if (invitation.acceptedAt) throw new ConflictException('Cette invitation a déjà été utilisée');
    if (invitation.expiresAt <= new Date()) {
      throw new BadRequestException('Cette invitation a expiré');
    }
    if (invitation.organization.deletedAt) {
      throw new BadRequestException('Cette organisation n’est plus disponible');
    }

    const user = await db.user.findUniqueOrThrow({ where: { id: request.auth!.userId } });
    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new ForbiddenException(
        'Cette invitation est destinée à une autre adresse e-mail : connectez-vous avec l’adresse invitée',
      );
    }

    const key = { userId: user.id, organizationId: invitation.organizationId };
    const member =
      (await db.member.findUnique({ where: { userId_organizationId: key } })) ??
      (await db.member.create({ data: { ...key, role: invitation.role } }));

    await db.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });
    await db.auditLog.create({
      data: {
        organizationId: invitation.organizationId,
        actorId: user.id,
        action: 'invitation.accepted',
        targetType: 'invitation',
        targetId: invitation.id,
        metadata: { email: invitation.email, role: member.role },
      },
    });

    return {
      organizationId: invitation.organizationId,
      organizationName: invitation.organization.name,
      role: organizationRoleSchema.parse(member.role),
    };
  }
}

function toInvitation(row: {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): Invitation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: organizationRoleSchema.parse(row.role),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    isPending: !row.acceptedAt && !row.revokedAt && row.expiresAt > new Date(),
  };
}
