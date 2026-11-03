-- CreateEnum
CREATE TYPE "TripVisibility" AS ENUM ('private', 'public');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'trip_full';

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "maxParticipants" INTEGER,
ADD COLUMN     "visibility" "TripVisibility" NOT NULL DEFAULT 'private';

