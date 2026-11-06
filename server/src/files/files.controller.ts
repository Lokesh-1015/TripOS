import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Res, UnauthorizedException, UnprocessableEntityException, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { CurrentUser, Public } from "../auth/session.guard.js";
import { parse } from "../common/validation.js";
import { PostsService } from "../posts/posts.service.js";
import { FileStorage } from "./file-storage.service.js";
import { CLEANABLE_IMAGES, detectType, removeImageMetadata } from "./image-safety.js";
import type { User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { fileUrl } from "../trips/trip.serializer.js";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_BYTES_PER_PERSON = 500 * 1024 * 1024;
// Only types browsers render safely are served inline; anything else downloads, so uploads can't run as pages.
const INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "video/mp4", "video/webm"]);

// "post" is a photo for a travel post: only its uploader can open it until it's posted, then the post decides.
const uploadBody = z.object({ tripId: z.string().optional(), visibility: z.enum(["public", "shared", "private", "post"]) });

@Controller("files")
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
    private readonly posts: PostsService,
  ) {}

  /** Decides what a file is from its contents, and rewrites images without their hidden details. */
  private async prepare(file: Express.Multer.File, isPublic: boolean) {
    const detected = detectType(file.buffer);
    const notValid = () => new UnprocessableEntityException({ message: `That doesn't look like a valid ${file.mimetype.startsWith("image/") ? "image" : "file"}. Please try another one.` });
    if (isPublic && !detected?.startsWith("image/")) throw notValid();
    if (isPublic && detected === "image/heic") throw new UnprocessableEntityException({ message: "Please use a JPG, PNG or WebP image here" });
    // Browsers would display these inline, so what's claimed has to match what's really there.
    const mimeType = INLINE_TYPES.has(file.mimetype) ? detected : file.mimetype;
    if (!mimeType || (INLINE_TYPES.has(file.mimetype) && !INLINE_TYPES.has(mimeType))) throw notValid();
    if (!CLEANABLE_IMAGES.includes(mimeType)) return { data: file.buffer, mimeType };
    try {
      return { data: await removeImageMetadata(file.buffer, mimeType), mimeType };
    } catch {
      throw notValid();
    }
  }

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_BYTES } }))
  async upload(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown) {
    if (!file) throw new UnprocessableEntityException({ message: "No file was uploaded" });
    const { tripId, visibility } = parse(uploadBody, body);
    if (visibility === "public" && !file.mimetype.startsWith("image/")) throw new UnprocessableEntityException({ message: "Only images can be used here" });
    if (visibility === "post" && !file.mimetype.startsWith("image/")) throw new UnprocessableEntityException({ message: "Posts are for photos" });
    if (visibility === "shared" || visibility === "private") {
      if (!tripId) throw new UnprocessableEntityException({ message: "A trip is required" });
      const member = await this.prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: user.id } } });
      if (member?.status !== "active" || member.role === "viewer") throw new ForbiddenException({ message: "You can't upload to this trip" });
    }
    const used = await this.prisma.storedFile.aggregate({ where: { uploadedBy: user.id }, _sum: { sizeBytes: true } });
    if ((used._sum.sizeBytes ?? 0) + file.size > MAX_BYTES_PER_PERSON) throw new UnprocessableEntityException({ message: "You've used all your storage space. Delete some photos or documents to add more." });
    const { data, mimeType } = await this.prepare(file, visibility === "public" || visibility === "post");
    const storageKey = await this.storage.save(data, mimeType);
    const row = await this.prisma.storedFile.create({
      data: {
        tripId: visibility === "public" || visibility === "post" ? null : tripId,
        uploadedBy: user.id,
        fileName: file.originalname,
        mimeType,
        sizeBytes: data.length,
        storageKey,
        metadataClean: CLEANABLE_IMAGES.includes(mimeType),
        isPublic: visibility === "public",
        visibility: visibility === "private" ? "private" : "shared",
        ...(storageKey ? {} : { blob: { create: { data: new Uint8Array(data) } } }),
      },
      select: { id: true },
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
      const allowed = file.postId
        ? await this.posts.canSee(user, { id: file.postId })
        : file.visibility === "private" || !file.tripId
          ? file.uploadedBy === user.id
          : member?.status === "active";
      // The same answer as a missing file, so ids of private files reveal nothing.
      if (!allowed) throw new NotFoundException();
    }
    const data = await this.storage.read(file);
    if (!data) throw new NotFoundException();
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Cache-Control", file.isPublic ? "public, max-age=86400" : "private, max-age=300");
    if (INLINE_TYPES.has(file.mimeType)) res.setHeader("Content-Disposition", "inline");
    else res.attachment(file.fileName);
    res.send(data);
  }
}
