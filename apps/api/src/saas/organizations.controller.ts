import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  addMemberSchema,
  createOrganizationSchema,
  organizationRoleSchema,
  organizationSchema,
  type AddMemberInput,
  type CreateOrganizationInput,
  type Member,
  type Organization,
} from '@ass/shared';
import { Db, ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { Inject } from '@nestjs/common';

function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${base || 'organisation'}-${randomUUID().slice(0, 6)}`;
}

@Controller('organizations')
@UseGuards(AuthGuard)
export class OrganizationsController {
  constructor(@Inject(Db) private readonly db: Db) {}

  /** Organisations de l'utilisateur connecté (pas besoin d'organisation active). */
  @Get()
  async list(@Req() request: AuthedRequest): Promise<Organization[]> {
    const members = await this.db.client.member.findMany({
      where: { userId: request.auth!.userId, organization: { deletedAt: null } },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      role: organizationSchema.shape.role.parse(m.role),
      createdAt: m.organization.createdAt.toISOString(),
    }));
  }

  @Post()
  async create(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(createOrganizationSchema)) body: CreateOrganizationInput,
  ): Promise<Organization> {
    const org = await this.db.client.organization.create({
      data: {
        name: body.name,
        slug: slugify(body.name),
        members: { create: { userId: request.auth!.userId, role: 'OWNER' } },
      },
    });
    await this.db.client.auditLog.create({
      data: {
        organizationId: org.id,
        actorId: request.auth!.userId,
        action: 'organization.created',
        targetType: 'organization',
        targetId: org.id,
      },
    });
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      role: 'OWNER',
      createdAt: org.createdAt.toISOString(),
    };
  }

  @Get(':id/members')
  @MinRole('VIEWER')
  async members(@Req() request: AuthedRequest, @Param('id') id: string): Promise<Member[]> {
    this.assertActiveOrg(request, id);
    const rows = await this.db.client.member.findMany({
      where: { organizationId: id },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: organizationRoleSchema.parse(m.role),
      createdAt: m.createdAt.toISOString(),
    }));
  }

  /** Ajoute un utilisateur déjà inscrit. Les invitations par e-mail arrivent en Phase 2. */
  @Post(':id/members')
  @MinRole('ADMIN')
  async addMember(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(addMemberSchema)) body: AddMemberInput,
  ): Promise<Member> {
    this.assertActiveOrg(request, id);
    const user = await this.db.client.user.findUnique({ where: { email: body.email } });
    if (!user) {
      throw new BadRequestException(
        'Aucun compte avec cette adresse. Demandez-lui de créer un compte avant de l’ajouter.',
      );
    }
    if (
      await this.db.client.member.findUnique({
        where: { userId_organizationId: { userId: user.id, organizationId: id } },
      })
    ) {
      throw new ConflictException('Cet utilisateur est déjà membre');
    }
    const member = await this.db.client.member.create({
      data: { userId: user.id, organizationId: id, role: body.role },
    });
    return {
      id: member.id,
      userId: user.id,
      email: user.email,
      name: user.name,
      role: organizationRoleSchema.parse(member.role),
      createdAt: member.createdAt.toISOString(),
    };
  }

  @Patch(':id/members/:memberId/role')
  @MinRole('OWNER')
  async changeRole(
    @Req() request: AuthedRequest,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body(new ZodPipe(addMemberSchema.pick({ role: true }))) body: { role: AddMemberInput['role'] },
  ): Promise<Member> {
    this.assertActiveOrg(request, id);
    const member = await this.db.client.member.update({
      where: { id: memberId },
      data: { role: body.role },
      include: { user: true },
    });
    return {
      id: member.id,
      userId: member.userId,
      email: member.user.email,
      name: member.user.name,
      role: organizationRoleSchema.parse(member.role),
      createdAt: member.createdAt.toISOString(),
    };
  }

  private assertActiveOrg(request: AuthedRequest, id: string): void {
    if (request.auth!.organizationId !== id) {
      throw new BadRequestException(
        "L'en-tête X-Organization-Id doit correspondre à l'organisation demandée",
      );
    }
  }
}
