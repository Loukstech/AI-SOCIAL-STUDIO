-- DropIndex
DROP INDEX "ContentVariant_projectId_platform_key";

-- AlterTable
ALTER TABLE "ContentVariant" ADD COLUMN     "language" "ContentLanguage" NOT NULL DEFAULT 'FR';

-- CreateIndex
CREATE UNIQUE INDEX "ContentVariant_projectId_platform_language_key" ON "ContentVariant"("projectId", "platform", "language");
