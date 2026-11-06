import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query, UnprocessableEntityException, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { z } from "zod";
import { CurrentUser } from "../auth/session.guard.js";
import { clientId, parse } from "../common/validation.js";
import type { User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SocialService } from "../social/social.service.js";
import { assertVerified } from "../trips/state.controller.js";
import { postInclude, PostsService } from "./posts.service.js";

const PAGE = 20;
const MAX_PHOTOS = 10;
const fileRef = z.string().regex(/^\/api\/files\/[\w-]+$/);
const visibility = z.enum(["public", "friends", "only_me"]);
const details = {
  caption: z.string().trim().max(2000),
  destination: z.string().trim().max(100),
};
const createBody = z
  .object({
    id: clientId,
    caption: details.caption.default(""),
    destination: details.destination.default(""),
    tripId: z.string().max(64).nullish(),
    visibility,
    photos: z.array(fileRef).max(MAX_PHOTOS).default([]),
    /** Sharing a trip memory: the post gets its own copy of this photo. */
    fromPhotoId: z.string().max(64).optional(),
  })
  .refine((p) => p.photos.length > 0 || p.fromPhotoId, { message: "Add at least one photo", path: ["photos"] });
const patchBody = z.object({ caption: details.caption.optional(), destination: details.destination.optional(), visibility: visibility.optional() });
const pageQuery = z.object({ before: z.iso.datetime().optional(), beforeId: z.string().max(64).optional() });
const commentBody = z.object({ text: z.string().trim().min(1).max(1000) });

const postLink = (id: string) => `/app/posts/${id}`;

/** Travel posts on people's profiles. Separate from trip memories: sharing a memory makes a copy. */
@UseGuards(ThrottlerGuard)
@Controller()
export class PostsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posts: PostsService,
    private readonly social: SocialService,
  ) {}

  /** Newest first, from friends, from anyone posting publicly, and your own. */
  @Get("feed")
  async feed(@CurrentUser() user: User, @Query() query: unknown) {
    const { before, beforeId } = parse(pageQuery, query);
    const cursor = before ? { OR: [{ createdAt: { lt: new Date(before) } }, { createdAt: new Date(before), id: { lt: beforeId ?? "" } }] } : {};
    const rows = await this.prisma.post.findMany({ where: { AND: [await this.posts.visibleWhere(user), cursor] }, include: postInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE + 1 });
    return { posts: await this.posts.toPost(user, rows.slice(0, PAGE)), hasMore: rows.length > PAGE };
  }

  @Get("profiles/:username/posts")
  async profilePosts(@CurrentUser() user: User, @Param("username") username: string, @Query() query: unknown) {
    const author = await this.social.findVisible(user, username);
    const { before, beforeId } = parse(pageQuery, query);
    const cursor = before ? { OR: [{ createdAt: { lt: new Date(before) } }, { createdAt: new Date(before), id: { lt: beforeId ?? "" } }] } : {};
    const rows = await this.prisma.post.findMany({ where: { AND: [{ authorId: author.id }, await this.posts.visibleWhere(user), cursor] }, include: postInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE + 1 });
    return { posts: await this.posts.toPost(user, rows.slice(0, PAGE)), hasMore: rows.length > PAGE };
  }

  @Get("posts/:id")
  async one(@CurrentUser() user: User, @Param("id") id: string) {
    const [post] = await this.posts.toPost(user, [await this.posts.visiblePost(user, id)]);
    return post;
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post("posts")
  async create(@CurrentUser() user: User, @Body() body: unknown) {
    assertVerified(user, "share posts");
    const input = parse(createBody, body);
    const existing = await this.prisma.post.findUnique({ where: { id: input.id } });
    if (existing) {
      // A retried create returns the same post, and can't be used to read someone else's.
      if (existing.authorId !== user.id) throw new UnprocessableEntityException({ message: "Please try again" });
      return this.one(user, input.id);
    }
    const fileIds = input.photos.map((url) => url.slice("/api/files/".length));
    if (input.fromPhotoId) {
      const copy = await this.posts.copyMemoryPhoto(user, input.fromPhotoId);
      fileIds.unshift(copy.fileId);
    }
    // Photos must be this person's own fresh uploads, not trip files or another post's.
    const files = await this.prisma.storedFile.findMany({ where: { id: { in: fileIds }, uploadedBy: user.id, tripId: null, postId: null, isPublic: false, mimeType: { startsWith: "image/" } }, select: { id: true } });
    if (files.length !== new Set(fileIds).size) throw new UnprocessableEntityException({ message: "A photo couldn't be found. Please add it again." });
    if (input.tripId) {
      const member = await this.prisma.tripMember.findUnique({ where: { tripId_userId: { tripId: input.tripId, userId: user.id } } });
      if (member?.status !== "active") throw new UnprocessableEntityException({ message: "You can only link a trip you're on" });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.post.create({ data: { id: input.id, authorId: user.id, caption: input.caption, destination: input.destination, tripId: input.tripId ?? null, visibility: input.visibility } });
      for (const [position, fileId] of fileIds.entries()) {
        await tx.storedFile.update({ where: { id: fileId }, data: { postId: input.id } });
        await tx.postPhoto.create({ data: { postId: input.id, fileId, position } });
      }
    });
    await this.social.ensureUsername(user);
    return this.one(user, input.id);
  }

  @Patch("posts/:id")
  async update(@CurrentUser() user: User, @Param("id") id: string, @Body() body: unknown) {
    const input = parse(patchBody, body);
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post || post.authorId !== user.id) throw new NotFoundException({ message: "This post isn't available" });
    await this.prisma.post.update({ where: { id }, data: { ...input, editedAt: new Date() } });
    return this.one(user, id);
  }

  /** Its photos go with it. A memory it was shared from isn't touched, as the post had its own copy. */
  @Delete("posts/:id")
  async remove(@CurrentUser() user: User, @Param("id") id: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) return { ok: true };
    if (post.authorId !== user.id && !this.social.isAdmin(user)) throw new NotFoundException({ message: "This post isn't available" });
    await this.deletePost(id);
    return { ok: true };
  }

  private async deletePost(id: string) {
    await this.prisma.$transaction([
      this.prisma.notification.deleteMany({ where: { link: postLink(id) } }),
      this.prisma.storedFile.deleteMany({ where: { postId: id } }),
      this.prisma.post.delete({ where: { id } }),
    ]);
  }

  @HttpCode(200)
  @Put("posts/:id/like")
  async like(@CurrentUser() user: User, @Param("id") id: string) {
    const post = await this.posts.visiblePost(user, id);
    const created = await this.prisma.postLike.createMany({ data: [{ postId: id, userId: user.id }], skipDuplicates: true });
    if (created.count && post.authorId !== user.id) await this.tellAuthor(post.authorId, id, "post_like", `${user.name} liked your post`, post.caption);
    return { liked: true };
  }

  @Delete("posts/:id/like")
  async unlike(@CurrentUser() user: User, @Param("id") id: string) {
    await this.posts.visiblePost(user, id);
    await this.prisma.postLike.deleteMany({ where: { postId: id, userId: user.id } });
    return { liked: false };
  }

  /** One unread notification per post and kind, so a popular post doesn't flood anyone. */
  private async tellAuthor(authorId: string, postId: string, kind: "post_like" | "post_comment", title: string, caption: string) {
    const waiting = await this.prisma.notification.count({ where: { userId: authorId, kind, link: postLink(postId), read: false } });
    if (waiting) return;
    await this.social.notify(authorId, { kind, title, body: caption.slice(0, 120) || "Your travel post", link: postLink(postId) });
  }

  @Get("posts/:id/comments")
  async comments(@CurrentUser() user: User, @Param("id") id: string) {
    const post = await this.posts.visiblePost(user, id);
    const hidden = await this.social.blockedIds(user.id);
    const rows = await this.prisma.postComment.findMany({ where: { postId: id, authorId: { notIn: [...hidden] }, author: { deletedAt: null, suspendedAt: null } }, include: { author: { select: { id: true, name: true, avatar: true, username: true } } }, orderBy: { createdAt: "asc" }, take: 500 });
    return rows.map((c) => ({ id: c.id, text: c.text, at: c.createdAt.toISOString(), author: c.author, canDelete: c.authorId === user.id || post.authorId === user.id }));
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post("posts/:id/comments")
  async comment(@CurrentUser() user: User, @Param("id") id: string, @Body() body: unknown) {
    assertVerified(user, "comment");
    const post = await this.posts.visiblePost(user, id);
    const { text } = parse(commentBody, body);
    const row = await this.prisma.postComment.create({ data: { postId: id, authorId: user.id, text } });
    if (post.authorId !== user.id) await this.tellAuthor(post.authorId, id, "post_comment", `${user.name} commented on your post`, text);
    return { id: row.id };
  }

  @Delete("posts/:id/comments/:commentId")
  async uncomment(@CurrentUser() user: User, @Param("id") id: string, @Param("commentId") commentId: string) {
    const comment = await this.prisma.postComment.findFirst({ where: { id: commentId, postId: id }, include: { post: { select: { authorId: true } } } });
    if (!comment) return { ok: true };
    // People delete their own comments. A post's author can tidy up comments on it.
    if (comment.authorId !== user.id && comment.post.authorId !== user.id) throw new ForbiddenException({ message: "You can only delete your own comments" });
    await this.prisma.postComment.delete({ where: { id: commentId } });
    return { ok: true };
  }

  @HttpCode(200)
  @Post("admin/posts/:id/remove")
  async adminRemove(@CurrentUser() user: User, @Param("id") id: string) {
    if (!this.social.isAdmin(user)) throw new NotFoundException();
    if (await this.prisma.post.findUnique({ where: { id }, select: { id: true } })) await this.deletePost(id);
    return { ok: true };
  }
}
