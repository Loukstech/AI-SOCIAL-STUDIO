#!/usr/bin/env node
/**
 * Nettoyage des comptes de test créés par les parcours E2E.
 *
 *   node scripts/cleanup-test-data.mjs
 *
 * Ne supprime que les utilisateurs dont l'adresse se termine par
 * `@ai-social-studio.test` et les organisations qui en dépendent. Affiche
 * l'état des tables avant et après.
 */
// Import relatif : `scripts/` est hors du graphe de dépendances du workspace.
import { createPrismaClient } from '../packages/database/dist/index.js';

const DOMAIN = '@ai-social-studio.test';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL manquant — lancer avec `node --env-file=.env …`');
  process.exit(1);
}

const prisma = createPrismaClient(databaseUrl);

const TABLES = [
  'user',
  'organization',
  'member',
  'invitation',
  'brand',
  'mediaAsset',
  'socialAccount',
  'videoProject',
  'contentProject',
  'publication',
  'publicationTarget',
  'publicationMetric',
  'notification',
  'notificationPreference',
  'comment',
  'task',
  'creditAccount',
  'creditTransaction',
  'imageProject',
  'auditLog',
];

async function snapshot() {
  const counts = {};
  for (const table of TABLES) counts[table] = await prisma[table].count();
  return counts;
}

async function main() {
  const before = await snapshot();
  console.log('Avant :', before);

  const users = await prisma.user.findMany({
    where: { email: { endsWith: DOMAIN } },
    select: { id: true, email: true },
  });
  console.log(`Comptes de test trouvés : ${users.length}`);

  if (users.length > 0) {
    const ids = users.map((user) => user.id);
    const organizations = await prisma.organization.findMany({
      where: { members: { some: { userId: { in: ids } } } },
      select: { id: true },
    });
    const orgIds = organizations.map((org) => org.id);

    if (orgIds.length > 0) {
      await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
      console.log(`Organisations supprimées : ${orgIds.length}`);
    }
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`Utilisateurs supprimés : ${ids.length}`);
  }

  // `AuditLog.organization` est en `SetNull` : les lignes survivent à la
  // suppression de l'organisation, orphelines et donc inatteignables.
  const orphans = await prisma.auditLog.deleteMany({ where: { organizationId: null } });
  console.log(`Journaux orphelins supprimés : ${orphans.count}`);

  const after = await snapshot();
  console.log('Après :', after);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
