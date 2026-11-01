import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "../generated/prisma/client.js";

/**
 * Local disk for development. Swap the three byte-handling lines for Cloudflare R2 (PRD §17)
 * once it has credentials; nothing outside this class knows where bytes live.
 */
@Injectable()
export class FileStorage {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>("UPLOAD_DIR", "uploads"));
  }

  async save(data: Buffer) {
    await mkdir(this.root, { recursive: true });
    const storageKey = randomBytes(24).toString("hex");
    await writeFile(join(this.root, storageKey), data);
    return storageKey;
  }

  path(storageKey: string) {
    return join(this.root, storageKey);
  }

  /** Deleting a document really deletes it: passports don't linger after someone removes them. */
  async remove(tx: Prisma.TransactionClient, fileId: string) {
    const file = await tx.storedFile.findUnique({ where: { id: fileId } });
    if (!file) return;
    await tx.storedFile.delete({ where: { id: fileId } });
    await rm(this.path(file.storageKey), { force: true });
  }
}
