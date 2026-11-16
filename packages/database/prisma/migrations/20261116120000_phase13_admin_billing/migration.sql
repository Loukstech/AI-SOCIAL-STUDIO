-- Administration plateforme (§17) et registre de crédits (§16.2).
-- Aucune donnée existante n'est détruite : les comptes restent actifs par défaut.

ALTER TABLE "User" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "planKey" TEXT NOT NULL DEFAULT 'free';

CREATE TYPE "CreditTransactionType" AS ENUM ('GRANT', 'RESERVE', 'CONFIRM', 'REFUND', 'ADJUST');

CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyCredits" INTEGER,
    "limits" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "label" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");
CREATE UNIQUE INDEX "CreditAccount_organizationId_key" ON "CreditAccount"("organizationId");
CREATE UNIQUE INDEX "CreditTransaction_idempotencyKey_key" ON "CreditTransaction"("idempotencyKey");
CREATE INDEX "CreditAccount_planKey_idx" ON "CreditAccount"("planKey");
CREATE INDEX "CreditTransaction_accountId_createdAt_idx" ON "CreditTransaction"("accountId", "createdAt");
CREATE INDEX "User_isSuperAdmin_idx" ON "User"("isSuperAdmin");
CREATE INDEX "Organization_planKey_idx" ON "Organization"("planKey");

ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_planKey_fkey"
  FOREIGN KEY ("planKey") REFERENCES "Plan"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "CreditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Plans initiaux. Les montants et limites sont modifiables en base : le code
-- ne contient aucun prix ni quota codé en dur.
INSERT INTO "Plan" ("id", "key", "name", "monthlyCredits", "limits", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'free', 'Découverte', 100, '{"brands": 1, "organizations": 1}', true, NOW(), NOW()),
  (gen_random_uuid(), 'starter', 'Starter', 1000, '{"brands": 5, "organizations": 2}', true, NOW(), NOW()),
  (gen_random_uuid(), 'pro', 'Pro', 5000, '{"brands": 20, "organizations": 5}', true, NOW(), NOW()),
  (gen_random_uuid(), 'business', 'Business', 20000, '{"brands": 100, "organizations": 20}', true, NOW(), NOW()),
  (gen_random_uuid(), 'agency', 'Agency', NULL, '{"brands": null, "organizations": null}', true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

-- Chaque organisation reçoit un compte de crédit initialisé à son plan.
INSERT INTO "CreditAccount" ("id", "organizationId", "planKey", "balance", "reserved", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", o."planKey", COALESCE(p."monthlyCredits", 0), 0, NOW(), NOW()
FROM "Organization" o
LEFT JOIN "Plan" p ON p."key" = o."planKey"
ON CONFLICT ("organizationId") DO NOTHING;
