-- AlterTable
ALTER TABLE "users" ADD COLUMN     "googleSub" TEXT,
ADD COLUMN     "mustConfirmEmail" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "users_googleSub_key" ON "users"("googleSub");

