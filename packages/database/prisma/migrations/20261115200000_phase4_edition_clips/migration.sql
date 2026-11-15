-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubtitleStyle" ADD VALUE 'KEYWORDS';
ALTER TYPE "SubtitleStyle" ADD VALUE 'DYNAMIC';
ALTER TYPE "SubtitleStyle" ADD VALUE 'CREATOR';
ALTER TYPE "SubtitleStyle" ADD VALUE 'PODCAST';

-- AlterTable
ALTER TABLE "SubtitleTrack" ADD COLUMN     "cues" JSONB;

-- CreateTable
CREATE TABLE "ClipSuggestion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "start" DOUBLE PRECISION NOT NULL,
    "end" DOUBLE PRECISION NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "score" INTEGER NOT NULL,
    "rationale" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClipSuggestion_projectId_score_idx" ON "ClipSuggestion"("projectId", "score");

-- AddForeignKey
ALTER TABLE "ClipSuggestion" ADD CONSTRAINT "ClipSuggestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

