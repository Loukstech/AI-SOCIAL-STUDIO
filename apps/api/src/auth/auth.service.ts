import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthResponse, LoginInput, RegisterInput, User } from '@ass/shared';
import { ENV, type Env } from '../config/env.js';
import { Db } from '../common/validation.js';
import { hashPassword, signToken, tokenFingerprint, verifyPassword } from './crypto.js';

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

function toUser(row: { id: string; email: string; name: string; createdAt: Date }): User {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.createdAt.toISOString() };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Crée la session et le jeton signé en une seule passe. */
  private async openSession(userId: string): Promise<AuthResponse> {
    if (!this.env.AUTH_SECRET) throw new UnauthorizedException('AUTH_SECRET non configuré');
    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = this.env.AUTH_TOKEN_TTL_HOURS * 3600;
    const sessionId = randomUUID();
    const token = signToken(
      { sub: userId, sid: sessionId, iat: now, exp: now + ttlSeconds },
      this.env.AUTH_SECRET,
    );
    await this.db.client.session.create({
      data: {
        id: sessionId,
        userId,
        tokenHash: tokenFingerprint(token),
        expiresAt: new Date((now + ttlSeconds) * 1000),
      },
    });
    const user = await this.db.client.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      token,
      expiresAt: new Date((now + ttlSeconds) * 1000).toISOString(),
      user: toUser(user),
    };
  }

  async register(input: RegisterInput): Promise<AuthResponse> {
    const db = this.db.client;
    if (await db.user.findUnique({ where: { email: input.email } })) {
      throw new ConflictException('Un compte existe déjà avec cette adresse');
    }
    const passwordHash = await hashPassword(input.password);
    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash },
      });
      const organization = await tx.organization.create({
        data: {
          name: input.organizationName ?? `Organisation de ${input.name}`,
          slug: slugify(input.organizationName ?? input.name),
          members: { create: { userId: created.id, role: 'OWNER' } },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: created.id,
          action: 'organization.created',
          targetType: 'organization',
          targetId: organization.id,
        },
      });
      return created;
    });
    return this.openSession(user.id);
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await this.db.client.user.findUnique({ where: { email: input.email } });
    if (!user || user.deletedAt || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Identifiants incorrects');
    }
    return this.openSession(user.id);
  }

  async me(userId: string): Promise<User> {
    return toUser(await this.db.client.user.findUniqueOrThrow({ where: { id: userId } }));
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.client.session.deleteMany({ where: { id: sessionId } });
  }
}
