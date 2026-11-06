-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'leave_request';
ALTER TYPE "NotificationKind" ADD VALUE 'leave_approved';
ALTER TYPE "NotificationKind" ADD VALUE 'leave_rejected';
ALTER TYPE "NotificationKind" ADD VALUE 'member_left';

-- AlterTable
ALTER TABLE "trip_members" ADD COLUMN     "leftAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "usernameChangedAt" TIMESTAMPTZ(6);

-- Every account gets a username. Deleted accounts get a "former." one, so their old name is free for others.
UPDATE "users" SET "username" = 'former.' || left(regexp_replace(lower("id"), '[^a-z0-9]', '', 'g'), 22)
WHERE "deletedAt" IS NOT NULL;
UPDATE "users" SET "username" =
  (CASE WHEN length(regexp_replace(lower("name"), '[^a-z0-9]', '', 'g')) >= 3
        THEN left(regexp_replace(lower("name"), '[^a-z0-9]', '', 'g'), 20) ELSE 'traveller' END)
  || left(md5("id"), 6)
WHERE "username" IS NULL;

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;

-- Usernames are lowercase, which makes them case-insensitive, and follow the same rule as the app.
ALTER TABLE "users" ADD CONSTRAINT "users_username_format" CHECK ("username" ~ '^[a-z0-9._]{3,30}$' AND "username" !~ '^\.' AND "username" !~ '\.$' AND "username" !~ '\.\.');

-- A username can change once every 30 days, whatever changes it. Deleting an account is the one exception.
CREATE FUNCTION "enforce_username_cooldown"() RETURNS trigger AS $$
BEGIN
  IF NEW."username" IS DISTINCT FROM OLD."username" THEN
    IF NEW."deletedAt" IS NULL THEN
      IF OLD."usernameChangedAt" IS NOT NULL AND OLD."usernameChangedAt" > now() - interval '30 days' THEN
        RAISE EXCEPTION 'username_cooldown: a username can only change once every 30 days' USING ERRCODE = 'check_violation';
      END IF;
      NEW."usernameChangedAt" := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_username_cooldown" BEFORE UPDATE OF "username" ON "users" FOR EACH ROW EXECUTE FUNCTION "enforce_username_cooldown"();

-- CreateTable
CREATE TABLE "trip_leave_requests" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMPTZ(6),
    "respondedById" TEXT,

    CONSTRAINT "trip_leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_leave_requests_tripId_status_idx" ON "trip_leave_requests"("tripId", "status");

-- AddForeignKey
ALTER TABLE "trip_leave_requests" ADD CONSTRAINT "trip_leave_requests_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

