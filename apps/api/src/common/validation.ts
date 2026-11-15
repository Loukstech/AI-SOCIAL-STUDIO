import {
  BadRequestException,
  ServiceUnavailableException,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { DatabaseService } from '../infra/database.service.js';

/** Valide et transforme le corps/paramètre avec un schéma Zod partagé. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        result.error.issues.map(
          (issue) => `${issue.path.join('.') || 'valeur'} : ${issue.message}`,
        ),
      );
    }
    return result.data;
  }
}

/** Garantit un client Prisma disponible, sinon 503 explicite plutôt qu'un crash. */
@Injectable()
export class Db {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  get client() {
    if (!this.database.client) {
      throw new ServiceUnavailableException('Base de données non configurée');
    }
    return this.database.client;
  }
}
