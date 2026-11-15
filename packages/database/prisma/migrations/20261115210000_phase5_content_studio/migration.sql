-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('PROMO', 'ANNOUNCEMENT', 'PROMOTION', 'COMPANY_INTRO', 'QUOTE', 'TIP', 'TUTORIAL', 'TESTIMONIAL', 'PRODUCT_LAUNCH', 'EVENT', 'SPECIAL_OFFER', 'EDUCATIONAL', 'VIDEO_SCRIPT', 'CAROUSEL');

-- CreateEnum
CREATE TYPE "ContentTone" AS ENUM ('PROFESSIONAL', 'DYNAMIC', 'FRIENDLY', 'EXPERT', 'INSPIRING', 'PLAYFUL');

-- CreateEnum
CREATE TYPE "ContentLanguage" AS ENUM ('FR', 'EN');

-- CreateTable
CREATE TABLE "ContentProject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "brief" TEXT NOT NULL,
    "subject" TEXT,
    "objective" TEXT,
    "audience" TEXT,
    "tone" "ContentTone" NOT NULL DEFAULT 'PROFESSIONAL',
    "contentType" "ContentType" NOT NULL DEFAULT 'PROMO',
    "language" "ContentLanguage" NOT NULL DEFAULT 'FR',
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ContentProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVariant" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "callToAction" TEXT,
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentProject_organizationId_createdAt_idx" ON "ContentProject"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentProject_deletedAt_idx" ON "ContentProject"("deletedAt");

-- CreateIndex
CREATE INDEX "ContentVariant_projectId_idx" ON "ContentVariant"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVariant_projectId_platform_key" ON "ContentVariant"("projectId", "platform");

-- AddForeignKey
ALTER TABLE "ContentProject" ADD CONSTRAINT "ContentProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentProject" ADD CONSTRAINT "ContentProject_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVariant" ADD CONSTRAINT "ContentVariant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ContentProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

