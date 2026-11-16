-- DropIndex
DROP INDEX "CreditTransaction_idempotencyKey_key";

-- AlterTable
ALTER TABLE "CreditTransaction" ADD COLUMN     "settledAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_accountId_idempotencyKey_key" ON "CreditTransaction"("accountId", "idempotencyKey");

