-- CreateEnum
CREATE TYPE "MetricSource" AS ENUM ('MANUAL', 'PLATFORM_API', 'WEBHOOK');

-- CreateTable
CREATE TABLE "PublicationMetric" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "source" "MetricSource" NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "views" INTEGER,
    "impressions" INTEGER,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "clicks" INTEGER,
    "note" TEXT,

    CONSTRAINT "PublicationMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicationMetric_organizationId_collectedAt_idx" ON "PublicationMetric"("organizationId", "collectedAt");

-- CreateIndex
CREATE INDEX "PublicationMetric_targetId_collectedAt_idx" ON "PublicationMetric"("targetId", "collectedAt");

-- AddForeignKey
ALTER TABLE "PublicationMetric" ADD CONSTRAINT "PublicationMetric_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "PublicationTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

