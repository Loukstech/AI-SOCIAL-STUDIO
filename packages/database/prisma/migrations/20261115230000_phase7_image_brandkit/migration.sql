-- CreateEnum
CREATE TYPE "ImageFormat" AS ENUM ('SQUARE', 'PORTRAIT_4_5', 'STORY_9_16', 'LANDSCAPE_16_9', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ImageStyle" AS ENUM ('EDITORIAL', 'BOLD', 'MINIMAL', 'GRADIENT');

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "bodyFont" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "editorialInstructions" TEXT,
ADD COLUMN     "headingFont" TEXT,
ADD COLUMN     "logoPrimaryId" TEXT,
ADD COLUMN     "logoSecondaryId" TEXT,
ADD COLUMN     "palette" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "referenceImageIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "slogan" TEXT,
ADD COLUMN     "socialLinks" JSONB,
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "ImageProject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "createdById" TEXT,
    "title" TEXT,
    "prompt" TEXT NOT NULL,
    "format" "ImageFormat" NOT NULL DEFAULT 'SQUARE',
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "style" "ImageStyle" NOT NULL DEFAULT 'EDITORIAL',
    "provider" TEXT NOT NULL DEFAULT 'svg',
    "model" TEXT NOT NULL DEFAULT 'layout-v1',
    "seed" INTEGER NOT NULL,
    "platform" "SocialPlatform",
    "palette" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "logoMediaId" TEXT,
    "referenceMediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "headline" TEXT,
    "subheadline" TEXT,
    "callToAction" TEXT,
    "badge" TEXT,
    "svg" TEXT NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ImageProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImageProject_organizationId_createdAt_idx" ON "ImageProject"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ImageProject_brandId_idx" ON "ImageProject"("brandId");

-- CreateIndex
CREATE INDEX "ImageProject_deletedAt_idx" ON "ImageProject"("deletedAt");

-- AddForeignKey
ALTER TABLE "ImageProject" ADD CONSTRAINT "ImageProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageProject" ADD CONSTRAINT "ImageProject_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

