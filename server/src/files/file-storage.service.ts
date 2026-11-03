import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { CLEANABLE_IMAGES, removeImageMetadata } from "./image-safety.js";

const MAINTENANCE_EVERY_MS = 10 * 60 * 1000;
const FIRST_MAINTENANCE_MS = 60 * 1000;
const BATCH = 10;

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/**
 * Keeps file contents in object storage when it's configured, and in the database when it isn't. Files
 * already in the database keep working, and are moved across a few at a time, each one checked first.
 */
@Injectable()
export class FileStorage implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FileStorage.name);
  private readonly bucket: string;
  /** Tests set this directly. Otherwise it's built from the settings below. */
  client: S3Client | null = null;
  /** Lets tests work on their own files, leaving everything else in the database alone. */
  onlyUploadedBy?: string;
  private timers: NodeJS.Timeout[] = [];
  private maintaining = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const endpoint = config.get<string>("OBJECT_STORAGE_ENDPOINT");
    const accessKeyId = config.get<string>("OBJECT_STORAGE_ACCESS_KEY");
    const secretAccessKey = config.get<string>("OBJECT_STORAGE_SECRET_KEY");
    this.bucket = config.get<string>("OBJECT_STORAGE_BUCKET", "tripos-files");
    if (endpoint && accessKeyId && secretAccessKey) {
      this.client = new S3Client({
        endpoint,
        region: config.get<string>("OBJECT_STORAGE_REGION", "auto"),
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
        requestChecksumCalculation: "WHEN_REQUIRED",
      });
    }
  }

  onModuleInit() {
    const run = () => void this.maintain(BATCH).catch((err: unknown) => this.logger.error("File upkeep failed", err instanceof Error ? err.stack : String(err)));
    this.timers = [setTimeout(run, FIRST_MAINTENANCE_MS), setInterval(run, MAINTENANCE_EVERY_MS)];
    this.timers.forEach((t) => t.unref());
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  get enabled() {
    return this.client !== null;
  }

  /** The key to record for a new file, or null if its contents should go in the database. An outage doesn't lose the upload. */
  async save(data: Buffer, mimeType: string): Promise<string | null> {
    if (!this.client) return null;
    const key = `files/${randomUUID()}`;
    try {
      await this.put(key, data, mimeType);
      return key;
    } catch (err) {
      this.logger.error("Object storage refused an upload, so it was kept in the database", err instanceof Error ? err.stack : String(err));
      return null;
    }
  }

  async read(file: { id: string; storageKey: string | null }): Promise<Buffer | null> {
    if (file.storageKey) return this.get(file.storageKey);
    const blob = await this.prisma.fileBlob.findUnique({ where: { fileId: file.id } });
    return blob ? Buffer.from(blob.data) : null;
  }

  /** Finishes deletes, cleans older photos and moves older files. Safe to run at any time. */
  async maintain(limit: number) {
    if (this.maintaining) return { deleted: 0, cleaned: 0, moved: 0, busy: true };
    this.maintaining = true;
    try {
      return { deleted: await this.emptyTrash(limit), cleaned: await this.cleanOlderPhotos(limit), moved: await this.moveOlderFiles(limit), busy: false };
    } finally {
      this.maintaining = false;
    }
  }

  /** Deleting a file row, including through a deleted trip, leaves its key here so the contents really go. */
  private async emptyTrash(limit: number) {
    if (!this.client) return 0;
    const rows = await this.prisma.storageTrash.findMany({ orderBy: { at: "asc" }, take: limit });
    let deleted = 0;
    for (const row of rows) {
      try {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: row.key }));
        await this.prisma.storageTrash.delete({ where: { key: row.key } });
        deleted++;
      } catch (err) {
        this.logger.warn(`Couldn't delete a stored file yet: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return deleted;
  }

  private async cleanOlderPhotos(limit: number) {
    const files = await this.prisma.storedFile.findMany({ where: { metadataClean: false, mimeType: { in: CLEANABLE_IMAGES }, uploadedBy: this.onlyUploadedBy }, take: limit, select: { id: true, storageKey: true, mimeType: true } });
    let cleaned = 0;
    for (const file of files) {
      try {
        const data = await this.read(file);
        if (data) {
          const clean = await removeImageMetadata(data, file.mimeType);
          if (file.storageKey) await this.put(file.storageKey, clean, file.mimeType);
          else await this.prisma.fileBlob.update({ where: { fileId: file.id }, data: { data: new Uint8Array(clean) } });
          await this.prisma.storedFile.update({ where: { id: file.id }, data: { metadataClean: true, sizeBytes: clean.length } });
          cleaned++;
        } else {
          await this.prisma.storedFile.updateMany({ where: { id: file.id }, data: { metadataClean: true } });
        }
      } catch (err) {
        // Something that can't be read as an image can't be cleaned, today or tomorrow.
        this.logger.warn(`Couldn't clean file ${file.id}: ${err instanceof Error ? err.message : String(err)}`);
        await this.prisma.storedFile.updateMany({ where: { id: file.id }, data: { metadataClean: true } });
      }
    }
    return cleaned;
  }

  private async moveOlderFiles(limit: number) {
    if (!this.client) return 0;
    const files = await this.prisma.storedFile.findMany({ where: { storageKey: null, blob: { isNot: null }, uploadedBy: this.onlyUploadedBy }, take: limit, select: { id: true, mimeType: true } });
    let moved = 0;
    for (const file of files) {
      const blob = await this.prisma.fileBlob.findUnique({ where: { fileId: file.id } });
      if (!blob) continue;
      const key = `files/${randomUUID()}`;
      try {
        await this.put(key, Buffer.from(blob.data), file.mimeType);
        const copy = await this.get(key);
        if (sha256(copy) !== sha256(blob.data)) throw new Error("The stored copy doesn't match");
        await this.prisma.$transaction([this.prisma.storedFile.update({ where: { id: file.id }, data: { storageKey: key } }), this.prisma.fileBlob.delete({ where: { fileId: file.id } })]);
        moved++;
      } catch (err) {
        // The database copy stays, so nothing is lost, and the next run tries again.
        this.logger.warn(`Couldn't move file ${file.id} yet: ${err instanceof Error ? err.message : String(err)}`);
        await this.prisma.storageTrash.upsert({ where: { key }, update: {}, create: { key } });
      }
    }
    return moved;
  }

  private async put(key: string, data: Buffer, mimeType: string) {
    await (this.client as S3Client).send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: mimeType }));
  }

  private async get(key: string) {
    if (!this.client) throw new Error("Object storage isn't configured, but a file is kept there");
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await (res.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
  }
}
