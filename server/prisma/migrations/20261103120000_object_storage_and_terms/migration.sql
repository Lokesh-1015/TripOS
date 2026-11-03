-- AlterTable
ALTER TABLE "files" ADD COLUMN     "metadataClean" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storageKey" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletedAt" TIMESTAMPTZ(6),
ADD COLUMN     "termsAcceptedAt" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "storage_trash" (
    "key" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_trash_pkey" PRIMARY KEY ("key")
);


-- A deleted file's contents are removed from object storage afterwards, however the row went (a cascade from a deleted trip, for example).
CREATE FUNCTION "remember_stored_file_for_deletion"() RETURNS trigger AS $$
BEGIN
  IF OLD."storageKey" IS NOT NULL THEN
    INSERT INTO "storage_trash" ("key") VALUES (OLD."storageKey") ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "files_remember_for_deletion" AFTER DELETE ON "files" FOR EACH ROW EXECUTE FUNCTION "remember_stored_file_for_deletion"();
