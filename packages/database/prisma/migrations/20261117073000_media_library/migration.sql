-- Médiathèque (§12) : metadata de recherche, favoris, versions et doublons.
-- Aucun binaire n'est stocké en base : `sourceUrl` reste la référence externe.

-- AlterTable
ALTER TABLE "MediaAsset"
  ADD COLUMN "folder" TEXT,
  ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "checksum" TEXT,
  ADD COLUMN "rights" TEXT,
  ADD COLUMN "versionOfId" TEXT;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_versionOfId_fkey"
  FOREIGN KEY ("versionOfId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "MediaAsset_organizationId_folder_idx" ON "MediaAsset"("organizationId", "folder");
CREATE INDEX "MediaAsset_organizationId_checksum_idx" ON "MediaAsset"("organizationId", "checksum");
CREATE INDEX "MediaAsset_organizationId_favorite_idx" ON "MediaAsset"("organizationId", "favorite");
