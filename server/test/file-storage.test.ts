// Moving files to object storage, with a small stand-in for the S3 API so the real client is exercised.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaPg } from "@prisma/adapter-pg";
import type { ConfigService } from "@nestjs/config";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FileStorage } from "../src/files/file-storage.service.js";
import { PrismaClient } from "../src/generated/prisma/client.js";
import type { PrismaService } from "../src/prisma/prisma.service.js";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }) });
const uploader = `storage-test-${randomUUID().slice(0, 8)}`;
const objects = new Map<string, Buffer>();
let corruptCopies = false;
let failing = false;
let server: Server;
let storage: FileStorage;

const config = (env: Record<string, string>) => ({ get: (key: string, fallback?: string) => env[key] ?? fallback }) as unknown as ConfigService;

beforeAll(async () => {
  server = createServer((req, res) => {
    const key = decodeURIComponent((req.url ?? "").split("?")[0]);
    if (failing) return void res.writeHead(500).end();
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        objects.set(key, Buffer.concat(chunks));
        res.writeHead(200, { ETag: '"x"' }).end();
      });
      return;
    }
    if (req.method === "GET") {
      const found = objects.get(key);
      if (!found) return void res.writeHead(404).end();
      const body = corruptCopies ? Buffer.from("not the same") : found;
      return void res.writeHead(200, { "Content-Length": body.length }).end(body);
    }
    objects.delete(key);
    res.writeHead(204).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  storage = new FileStorage(db as unknown as PrismaService, config({ OBJECT_STORAGE_ENDPOINT: `http://127.0.0.1:${port}`, OBJECT_STORAGE_ACCESS_KEY: "test", OBJECT_STORAGE_SECRET_KEY: "test", OBJECT_STORAGE_BUCKET: "bucket", OBJECT_STORAGE_REGION: "auto" }));
  storage.onlyUploadedBy = uploader;
  vi.spyOn((storage as unknown as { logger: { warn: () => void; error: () => void } }).logger, "warn").mockImplementation(() => undefined);
  vi.spyOn((storage as unknown as { logger: { warn: () => void; error: () => void } }).logger, "error").mockImplementation(() => undefined);
});

afterAll(async () => {
  await db.storedFile.deleteMany({ where: { uploadedBy: uploader } });
  await db.$disconnect();
  server.close();
});

const inDatabase = (data: Uint8Array, mimeType = "application/pdf", metadataClean = true) =>
  db.storedFile.create({ data: { uploadedBy: uploader, fileName: "f", mimeType, sizeBytes: data.length, isPublic: false, metadataClean, blob: { create: { data: new Uint8Array(data) } } } });

const maintainUntilQuiet = async () => {
  for (let i = 0; i < 30; i++) {
    const done = await storage.maintain(50);
    if (!done.moved && !done.cleaned && !done.deleted) return;
  }
};

describe("FileStorage", () => {
  it("is off without settings, and files stay in the database as they always have", async () => {
    const off = new FileStorage(db as unknown as PrismaService, config({}));
    expect(off.enabled).toBe(false);
    expect(await off.save(Buffer.from("x"), "text/plain")).toBeNull();
    const file = await inDatabase(Buffer.from("%PDF-1.4 kept"));
    expect((await off.read(file))?.toString()).toBe("%PDF-1.4 kept");
  });

  it("moves an older file across, checks it, and only then removes the database copy", async () => {
    const file = await inDatabase(Buffer.from("%PDF-1.4 ticket"));
    await maintainUntilQuiet();
    const moved = await db.storedFile.findUniqueOrThrow({ where: { id: file.id }, include: { blob: true } });
    expect(moved.storageKey).not.toBeNull();
    expect(moved.blob).toBeNull();
    expect((await storage.read(moved))?.toString()).toBe("%PDF-1.4 ticket");
  });

  it("keeps the database copy if the stored copy doesn't match", async () => {
    const file = await inDatabase(Buffer.from("%PDF-1.4 passport"));
    corruptCopies = true;
    await storage.maintain(50);
    corruptCopies = false;
    const row = await db.storedFile.findUniqueOrThrow({ where: { id: file.id }, include: { blob: true } });
    expect(row.storageKey).toBeNull();
    expect(Buffer.from(row.blob?.data ?? []).toString()).toBe("%PDF-1.4 passport");
    await maintainUntilQuiet();
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: file.id } })).storageKey).not.toBeNull();
  });

  it("keeps the database copy if storage is down, and a new upload isn't lost", async () => {
    failing = true;
    const file = await inDatabase(Buffer.from("%PDF-1.4 outage"));
    await storage.maintain(50);
    expect(await storage.save(Buffer.from("x"), "text/plain")).toBeNull();
    failing = false;
    const row = await db.storedFile.findUniqueOrThrow({ where: { id: file.id }, include: { blob: true } });
    expect(row.storageKey).toBeNull();
    expect(row.blob).not.toBeNull();
  });

  it("removes the GPS position from older photos", async () => {
    const photo = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#123456" } })
      .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "15/1 29/1 0/1" } })
      .jpeg()
      .toBuffer();
    const file = await inDatabase(photo, "image/jpeg", false);
    await maintainUntilQuiet();
    const row = await db.storedFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.metadataClean).toBe(true);
    const data = await storage.read(row);
    expect((await sharp(data as Buffer).metadata()).exif).toBeUndefined();
  });

  it("doesn't get stuck on something that can't be read as an image", async () => {
    const file = await inDatabase(Buffer.from("not an image"), "image/jpeg", false);
    await maintainUntilQuiet();
    const row = await db.storedFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.metadataClean).toBe(true);
    expect((await storage.read(row))?.toString()).toBe("not an image");
  });

  it("removes a file's contents when its row is deleted, including through a deleted trip", async () => {
    const data = Buffer.from("%PDF-1.4 goodbye");
    const key = await storage.save(data, "application/pdf");
    expect(objects.has(`/bucket/${key}`)).toBe(true);
    const file = await db.storedFile.create({ data: { uploadedBy: uploader, fileName: "f", mimeType: "application/pdf", sizeBytes: data.length, isPublic: false, storageKey: key } });
    await db.storedFile.delete({ where: { id: file.id } });
    expect(await db.storageTrash.count({ where: { key: key as string } })).toBe(1);
    await maintainUntilQuiet();
    expect(objects.has(`/bucket/${key}`)).toBe(false);
    expect(await db.storageTrash.count({ where: { key: key as string } })).toBe(0);
  });
});
