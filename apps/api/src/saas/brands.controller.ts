import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createBrandSchema, type Brand, type CreateBrandInput } from '@ass/shared';
import { Db, ZodPipe } from '../common/validation.js';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';

@Controller('brands')
@UseGuards(AuthGuard)
export class BrandsController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Get()
  @MinRole('VIEWER')
  async list(@Req() request: AuthedRequest): Promise<Brand[]> {
    const rows = await this.db.client.brand.findMany({
      where: { organizationId: this.org(request), deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toBrand);
  }

  @Post()
  @MinRole('ADMIN')
  async create(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(createBrandSchema)) body: CreateBrandInput,
  ): Promise<Brand> {
    const brand = await this.db.client.brand.create({
      data: { ...body, organizationId: this.org(request) },
    });
    await this.db.client.auditLog.create({
      data: {
        organizationId: brand.organizationId,
        actorId: request.auth!.userId,
        action: 'brand.created',
        targetType: 'brand',
        targetId: brand.id,
      },
    });
    return toBrand(brand);
  }

  @Delete(':id')
  @HttpCode(204)
  @MinRole('ADMIN')
  async remove(@Req() request: AuthedRequest, @Param('id') id: string): Promise<void> {
    const brand = await this.db.client.brand.findFirst({
      where: { id, organizationId: this.org(request), deletedAt: null },
    });
    if (!brand) throw new NotFoundException('Marque introuvable');
    await this.db.client.brand.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private org(request: AuthedRequest): string {
    if (!request.auth?.organizationId) {
      throw new NotFoundException('Organisation active requise (X-Organization-Id)');
    }
    return request.auth.organizationId;
  }
}

function toBrand(row: {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  primaryColor: string | null;
  toneOfVoice: string | null;
  createdAt: Date;
}): Brand {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    ...(row.primaryColor ? { primaryColor: row.primaryColor } : {}),
    ...(row.toneOfVoice ? { toneOfVoice: row.toneOfVoice } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}
