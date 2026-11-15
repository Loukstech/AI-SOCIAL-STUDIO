-- CreateEnum
CREATE TYPE "PostType" AS ENUM ('TEXT', 'IMAGE', 'GALLERY', 'VIDEO', 'REEL', 'SHORT', 'CAROUSEL', 'LINK');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'REJECTED', 'CANCELLED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PublicationMode" AS ENUM ('AUTO', 'APPROVAL');

-- CreateEnum
CREATE TYPE "PublicationTargetStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris';

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "createdById" TEXT,
    "contentProjectId" TEXT,
    "title" TEXT,
    "postType" "PostType" NOT NULL DEFAULT 'TEXT',
    "mode" "PublicationMode" NOT NULL DEFAULT 'AUTO',
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "rejectionReason" TEXT,
    "mediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationTarget" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "body" TEXT NOT NULL,
    "title" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PublicationTargetStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "externalUrl" TEXT,
    "error" TEXT,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "PublicationTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationEvent" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "fromStatus" "PublicationStatus",
    "toStatus" "PublicationStatus" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Publication_organizationId_status_scheduledAt_idx" ON "Publication"("organizationId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Publication_organizationId_scheduledAt_idx" ON "Publication"("organizationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Publication_deletedAt_idx" ON "Publication"("deletedAt");

-- CreateIndex
CREATE INDEX "PublicationTarget_publicationId_idx" ON "PublicationTarget"("publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationTarget_publicationId_socialAccountId_key" ON "PublicationTarget"("publicationId", "socialAccountId");

-- CreateIndex
CREATE INDEX "PublicationEvent_publicationId_createdAt_idx" ON "PublicationEvent"("publicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_contentProjectId_fkey" FOREIGN KEY ("contentProjectId") REFERENCES "ContentProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationTarget" ADD CONSTRAINT "PublicationTarget_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationTarget" ADD CONSTRAINT "PublicationTarget_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationEvent" ADD CONSTRAINT "PublicationEvent_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

