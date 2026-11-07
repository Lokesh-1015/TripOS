-- AlterTable
ALTER TABLE "email_verification_tokens" ADD COLUMN     "email" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pendingEmail" TEXT;

