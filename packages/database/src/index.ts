import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export { PrismaClient };
export { OrganizationRole, MediaKind } from './generated/enums.js';

/** Crée un client Prisma branché sur PostgreSQL via le pilote `pg`. */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
