-- Référence vers le binaire dans le stockage objet (§12).
-- NULL = média sans fichier (URL externe ou simple enregistrement de métadonnées).
ALTER TABLE "MediaAsset" ADD COLUMN "storageKey" TEXT;

-- Une clé ne peut appartenir qu'à un seul média. PostgreSQL autorise
-- plusieurs NULL dans un index unique, ce qui est précisément ce qu'on veut.
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");
