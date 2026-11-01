-- Keep attachment names that were saved before files were stored.
CREATE TEMP TABLE legacy_attachments AS SELECT id AS "activityId", unnest(attachments) AS name FROM activities;

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('travel', 'activity', 'meal', 'stay', 'free');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'done');

-- AlterTable
ALTER TABLE "activities" DROP COLUMN "attachments",
ADD COLUMN     "type" "ActivityType" NOT NULL DEFAULT 'activity';

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "fxRate" DOUBLE PRECISION,
ADD COLUMN     "originalAmountMinor" INTEGER,
ADD COLUMN     "originalCurrency" TEXT;

-- AlterTable
ALTER TABLE "settlements" ADD COLUMN     "isAdjustment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "status" "TaskStatus" NOT NULL DEFAULT 'todo';

-- CreateTable
CREATE TABLE "activity_attachments" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_attachments_activityId_createdAt_idx" ON "activity_attachments"("activityId", "createdAt");

-- AddForeignKey
ALTER TABLE "activity_attachments" ADD CONSTRAINT "activity_attachments_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Bring existing data across.
INSERT INTO "activity_attachments" (id, "activityId", name) SELECT gen_random_uuid()::text, "activityId", name FROM legacy_attachments;
DROP TABLE legacy_attachments;
UPDATE "tasks" SET status = 'done' WHERE done;
