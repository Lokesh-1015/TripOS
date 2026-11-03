-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('public', 'private');

-- CreateEnum
CREATE TYPE "FriendRequestsFrom" AS ENUM ('everyone', 'nobody');

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('pending', 'accepted', 'declined');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('open', 'reviewed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'friend_request';
ALTER TYPE "NotificationKind" ADD VALUE 'friend_accept';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "coverPhoto" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "favouriteDestinations" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "friendRequestsFrom" "FriendRequestsFrom" NOT NULL DEFAULT 'everyone',
ADD COLUMN     "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "location" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "placesVisited" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "profileVisibility" "ProfileVisibility" NOT NULL DEFAULT 'private',
ADD COLUMN     "suspendedAt" TIMESTAMPTZ(6),
ADD COLUMN     "username" TEXT;

-- CreateTable
CREATE TABLE "friendships" (
    "id" TEXT NOT NULL,
    "userLowId" TEXT NOT NULL,
    "userHighId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMPTZ(6),

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "status" "ReportStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "friendships_userHighId_idx" ON "friendships"("userHighId");

-- CreateIndex
CREATE UNIQUE INDEX "friendships_userLowId_userHighId_key" ON "friendships"("userLowId", "userHighId");

-- CreateIndex
CREATE INDEX "blocks_blockedId_idx" ON "blocks"("blockedId");

-- CreateIndex
CREATE INDEX "reports_status_createdAt_idx" ON "reports"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Destinations people saved on the old Explore page become their favourites, as names rather than ids.
UPDATE "users" SET "favouriteDestinations" = (SELECT array_agg(initcap(replace(d, '-', ' '))) FROM unnest("savedDestinations") AS d) WHERE cardinality("savedDestinations") > 0;
