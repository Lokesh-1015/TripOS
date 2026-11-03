-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "placeAddress" TEXT,
ADD COLUMN     "placeLat" DOUBLE PRECISION,
ADD COLUMN     "placeLng" DOUBLE PRECISION,
ADD COLUMN     "placeName" TEXT;

-- AlterTable
ALTER TABLE "photos" ADD COLUMN     "activityId" TEXT,
ADD COLUMN     "highlight" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "placeId" TEXT;

