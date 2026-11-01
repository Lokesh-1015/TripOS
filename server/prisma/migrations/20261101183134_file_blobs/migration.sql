-- DropIndex
DROP INDEX "files_storageKey_key";

-- AlterTable
ALTER TABLE "files" DROP COLUMN "storageKey";

-- CreateTable
CREATE TABLE "file_blobs" (
    "fileId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "file_blobs_pkey" PRIMARY KEY ("fileId")
);

-- AddForeignKey
ALTER TABLE "file_blobs" ADD CONSTRAINT "file_blobs_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

