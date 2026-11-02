-- AlterTable
ALTER TABLE "places" ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ALTER COLUMN "x" SET DEFAULT 0,
ALTER COLUMN "y" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "live_locations" (
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "live_locations_pkey" PRIMARY KEY ("tripId","userId")
);

-- CreateIndex
CREATE INDEX "live_locations_userId_idx" ON "live_locations"("userId");

-- CreateIndex
CREATE INDEX "live_locations_expiresAt_idx" ON "live_locations"("expiresAt");

-- AddForeignKey
ALTER TABLE "live_locations" ADD CONSTRAINT "live_locations_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_locations" ADD CONSTRAINT "live_locations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

