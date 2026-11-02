-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "placeId" TEXT;

-- CreateTable
CREATE TABLE "reminders_sent" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_sent_pkey" PRIMARY KEY ("userId","key")
);

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders_sent" ADD CONSTRAINT "reminders_sent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

