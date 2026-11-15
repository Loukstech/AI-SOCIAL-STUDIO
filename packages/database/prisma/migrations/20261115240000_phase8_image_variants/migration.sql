-- AlterTable
ALTER TABLE "ImageProject" ADD COLUMN     "sourceProjectId" TEXT;

-- CreateIndex
CREATE INDEX "ImageProject_sourceProjectId_idx" ON "ImageProject"("sourceProjectId");

-- AddForeignKey
ALTER TABLE "ImageProject" ADD CONSTRAINT "ImageProject_sourceProjectId_fkey" FOREIGN KEY ("sourceProjectId") REFERENCES "ImageProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

