-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('pending', 'accepted', 'rejected', 'cancelled');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'trip_visibility';
ALTER TYPE "NotificationKind" ADD VALUE 'join_request';
ALTER TYPE "NotificationKind" ADD VALUE 'join_accepted';
ALTER TYPE "NotificationKind" ADD VALUE 'join_rejected';

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "category" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "showBudget" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showPlan" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "travelStyle" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "join_requests" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMPTZ(6),

    CONSTRAINT "join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "join_requests_userId_idx" ON "join_requests"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "join_requests_tripId_userId_key" ON "join_requests"("tripId", "userId");

-- CreateIndex
CREATE INDEX "trips_visibility_archived_startDate_idx" ON "trips"("visibility", "archived", "startDate");

-- AddForeignKey
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

