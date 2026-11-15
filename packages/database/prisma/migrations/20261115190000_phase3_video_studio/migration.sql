-- CreateEnum
CREATE TYPE "VideoProjectStatus" AS ENUM ('DRAFT', 'TRANSCRIBING', 'TRANSCRIBED', 'FAILED');

-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SubtitleStyle" AS ENUM ('PROFESSIONAL', 'MINIMAL', 'KARAOKE');

-- CreateTable
CREATE TABLE "VideoProject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceUrl" TEXT,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "durationSeconds" INTEGER,
    "status" "VideoProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "VideoProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "TranscriptStatus" NOT NULL DEFAULT 'PENDING',
    "language" TEXT NOT NULL DEFAULT 'fr',
    "provider" TEXT,
    "text" TEXT,
    "segments" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubtitleTrack" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "style" "SubtitleStyle" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "content" TEXT NOT NULL,
    "cueCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubtitleTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoProject_organizationId_createdAt_idx" ON "VideoProject"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoProject_brandId_idx" ON "VideoProject"("brandId");

-- CreateIndex
CREATE INDEX "VideoProject_deletedAt_idx" ON "VideoProject"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_projectId_key" ON "Transcript"("projectId");

-- CreateIndex
CREATE INDEX "SubtitleTrack_projectId_idx" ON "SubtitleTrack"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SubtitleTrack_projectId_style_language_key" ON "SubtitleTrack"("projectId", "style", "language");

-- AddForeignKey
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtitleTrack" ADD CONSTRAINT "SubtitleTrack_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

