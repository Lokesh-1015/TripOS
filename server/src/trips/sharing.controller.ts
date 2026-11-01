import { Body, ConflictException, Controller, Delete, NotFoundException, Param, Put, UnprocessableEntityException, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/session.guard.js";
import { Actor, enforce, RequiresTripRole, TripAccessGuard } from "../authz/trip-access.guard.js";
import { canContribute, canManageOwnContent } from "../authz/trip-policies.js";
import type { TripActor } from "../authz/trip-roles.js";
import { asDate, clientId, isoDate, parse, shortText } from "../common/validation.js";
import { FileStorage } from "../files/file-storage.service.js";
import type { Prisma, User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { TripWriter } from "./trip-writer.service.js";

const fileRef = z.string().regex(/^\/api\/files\/[\w-]+$/);
const fileIdOf = (url: string) => url.slice("/api/files/".length);

const documentBody = z.object({
  name: shortText.min(1),
  category: z.enum(["tickets", "hotel", "identity", "insurance", "bookings", "emergency", "other"]),
  fileType: z.string().max(16),
  size: z.string().max(32),
  uploadedAt: isoDate,
  visibility: z.enum(["shared", "private"]),
  dataUrl: fileRef.optional(),
});

const messageBody = z.object({
  kind: z.enum(["text", "poll", "location", "image", "file"]),
  text: z.string().max(5000).default(""),
  pollId: z.string().optional(),
  placeId: z.string().optional(),
  imageUrl: fileRef.optional(),
  fileName: z.string().max(255).optional(),
  fileUrl: fileRef.optional(),
  pinned: z.boolean().optional(),
});

const photoBody = z.object({
  url: fileRef,
  caption: shortText.default(""),
  day: z.number().int().min(0).max(366),
  album: z.string().trim().min(1).max(80),
  kind: z.enum(["photo", "video"]),
});

/** A file can only be attached to the trip it was uploaded to, by someone on that trip. */
export async function assertFile(tx: Prisma.TransactionClient, tripId: string, url: string | undefined, userId: string) {
  if (!url) return;
  const file = await tx.storedFile.findUnique({ where: { id: fileIdOf(url) } });
  if (!file || file.tripId !== tripId || file.uploadedBy !== userId) throw new UnprocessableEntityException({ message: "That file couldn't be found. Please upload it again." });
}

@UseGuards(TripAccessGuard)
@RequiresTripRole("viewer")
@Controller("trips/:tripId")
export class SharingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: TripWriter,
    private readonly files: FileStorage,
  ) {}

  @Put("documents/:id")
  async upsertDocument(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canContribute(actor));
    parse(clientId, id);
    const input = parse(documentBody, body);
    const existing = await this.prisma.tripDocument.findUnique({ where: { id } });
    if (existing) {
      if (existing.tripId !== tripId) throw new ConflictException({ message: "Please try again" });
      return { ok: true };
    }
    await this.writer.run(tripId, user.id, async ({ tx, log, notify, tripName }) => {
      await assertFile(tx, tripId, input.dataUrl, user.id);
      const fileId = input.dataUrl ? fileIdOf(input.dataUrl) : undefined;
      await tx.tripDocument.create({
        data: { id, tripId, name: input.name, category: input.category, fileType: input.fileType, size: input.size, uploadedBy: user.id, uploadedAt: asDate(input.uploadedAt), visibility: input.visibility, fileId },
      });
      if (fileId) await tx.storedFile.update({ where: { id: fileId }, data: { visibility: input.visibility } });
      if (input.visibility === "shared") {
        await log(`uploaded “${input.name}”`, "document");
        await notify({ kind: "document", title: "New document uploaded", body: `${input.name} · ${tripName}`, link: `/app/trips/${tripId}/documents` });
      }
    });
    return { ok: true };
  }

  @Delete("documents/:id")
  async removeDocument(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User) {
    const doc = await this.prisma.tripDocument.findFirst({ where: { id, tripId } });
    if (!doc) return { ok: true };
    // Private documents don't exist as far as anyone else is concerned, admins included.
    if (doc.visibility === "private" && doc.uploadedBy !== user.id) throw new NotFoundException({ message: "That document doesn't exist" });
    enforce(canManageOwnContent(actor, doc.uploadedBy, "document"));
    await this.writer.run(tripId, user.id, async ({ tx }) => {
      await tx.tripDocument.delete({ where: { id } });
      if (doc.fileId) await this.files.remove(tx, doc.fileId);
    });
    return { ok: true };
  }

  @Put("messages/:id")
  async upsertMessage(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canContribute(actor));
    parse(clientId, id);
    const input = parse(messageBody, body);
    const existing = await this.prisma.message.findUnique({ where: { id } });
    if (existing && existing.tripId !== tripId) throw new ConflictException({ message: "Please try again" });
    await this.writer.run(tripId, user.id, async ({ tx, notify, tripName }) => {
      if (existing) {
        // Sent messages can't be rewritten; pinning is the only change the UI offers.
        if (input.pinned !== undefined) await tx.message.update({ where: { id }, data: { pinned: input.pinned } });
        return;
      }
      await assertFile(tx, tripId, input.imageUrl, user.id);
      await assertFile(tx, tripId, input.fileUrl, user.id);
      await tx.message.create({ data: { id, tripId, authorId: user.id, kind: input.kind, text: input.text, pollId: input.pollId, placeId: input.placeId, imageUrl: input.imageUrl, fileName: input.fileName, fileUrl: input.fileUrl, pinned: input.pinned ?? false } });
      // One unread chat notification per trip, not one per message.
      await notify({ kind: "message", title: `New messages in ${tripName}`, body: `${user.name.split(" ")[0]}: ${input.text || "shared an attachment"}`.slice(0, 200), link: `/app/trips/${tripId}/chat`, collapseUnread: true });
    });
    return { ok: true };
  }

  @Put("photos/:id")
  async upsertPhoto(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canContribute(actor));
    parse(clientId, id);
    const input = parse(photoBody, body);
    const existing = await this.prisma.photo.findUnique({ where: { id } });
    if (existing) {
      if (existing.tripId !== tripId) throw new ConflictException({ message: "Please try again" });
      return { ok: true };
    }
    await this.writer.run(tripId, user.id, async ({ tx, log }) => {
      await assertFile(tx, tripId, input.url, user.id);
      await tx.photo.create({ data: { ...input, id, tripId, authorId: user.id } });
      await log("added a photo to Memories", "memory");
    });
    return { ok: true };
  }

  @Delete("photos/:id")
  async removePhoto(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User) {
    const photo = await this.prisma.photo.findFirst({ where: { id, tripId } });
    if (!photo) return { ok: true };
    enforce(canManageOwnContent(actor, photo.authorId, "photo"));
    await this.writer.run(tripId, user.id, async ({ tx }) => {
      await tx.photo.delete({ where: { id } });
      await this.files.remove(tx, fileIdOf(photo.url));
    });
    return { ok: true };
  }
}
