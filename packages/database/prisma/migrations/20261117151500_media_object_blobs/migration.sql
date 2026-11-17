-- Stockage des binaires de la médiathèque directement dans PostgreSQL (§12).
-- Table séparée de MediaAsset : les listes de médias ne chargent jamais les octets.
CREATE TABLE "MediaObject" (
    "storageKey" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaObject_pkey" PRIMARY KEY ("storageKey")
);

CREATE INDEX "MediaObject_createdAt_idx" ON "MediaObject"("createdAt");
