import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Res, UnauthorizedException, UnprocessableEntityException, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { CurrentUser, Public } from "../auth/session.guard.js";
import { parse } from "../common/validation.js";
import type { User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { fileUrl } from "../trips/trip.serializer.js";
import { FileStorage } from "./file-storage.service.js";

const MAX_BYTES = 25 * 1024 * 1024;
// Only types browsers render safely are served inline; anything else downloads, so uploads can't run as pages.
const INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "video/mp4", "video/webm"]);

const uploadBody = z.object({ tripId: z.string().optional(), visibility: z.enum(["public", "shared", "private"]) });

@Controller("files")
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_BYTES } }))
  async upload(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown) {
    if (!file) throw new UnprocessableEntityException({ message: "No file was uploaded" });
    const { tripId, visibility } = parse(uploadBody, body);
    if (visibility === "public" && !file.mimetype.startsWith("image/")) throw new UnprocessableEntityException({ message: "Only images can be used here" });
    if (visibility !== "public") {
      if (!tripId) throw new UnprocessableEntityException({ message: "A trip is required" });
      const member = await this.prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: user.id } } });
      if (member?.status !== "active" || member.role === "viewer") throw new ForbiddenException({ message: "You can't upload to this trip" });
    }
    const storageKey = await this.storage.save(file.buffer);
    const row = await this.prisma.storedFile.create({
      data: {
        tripId: visibility === "public" ? null : tripId,
        uploadedBy: user.id,
        storageKey,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        isPublic: visibility === "public",
        visibility: visibility === "private" ? "private" : "shared",
      },
    });
    return { id: row.id, url: fileUrl(row.id) };
  }

  @Public()
  @Get(":id")
  async read(@Param("id") id: string, @CurrentUser() user: User | undefined, @Res() res: Response) {
    const file = await this.prisma.storedFile.findUnique({ where: { id } });
    if (!file) throw new NotFoundException();
    if (!file.isPublic) {
      if (!user) throw new UnauthorizedException({ message: "Please log in" });
      const member = file.tripId ? await this.prisma.tripMember.findUnique({ where: { tripId_userId: { tripId: file.tripId, userId: user.id } } }) : null;
      const allowed = file.visibility === "private" || !file.tripId ? file.uploadedBy === user.id : member?.status === "active";
      // The same answer as a missing file, so ids of private files reveal nothing.
      if (!allowed) throw new NotFoundException();
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Cache-Control", file.isPublic ? "public, max-age=86400" : "private, max-age=300");
    if (INLINE_TYPES.has(file.mimeType)) res.setHeader("Content-Disposition", "inline");
    else res.attachment(file.fileName);
    res.sendFile(this.storage.path(file.storageKey));
  }
}
