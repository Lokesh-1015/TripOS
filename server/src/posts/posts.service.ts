import { Injectable, NotFoundException } from "@nestjs/common";
import type { Post, Prisma, User } from "../generated/prisma/client.js";
import { FileStorage } from "../files/file-storage.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SocialService } from "../social/social.service.js";
import { fileUrl } from "../trips/trip.serializer.js";

export const postInclude = {
  author: { select: { id: true, name: true, avatar: true, username: true, deletedAt: true, suspendedAt: true } },
  photos: { orderBy: { position: "asc" }, select: { fileId: true } },
  trip: { select: { id: true, name: true, visibility: true, members: { where: { status: "active" }, select: { userId: true } } } },
  _count: { select: { likes: true, comments: true } },
} satisfies Prisma.PostInclude;
export type PostRow = Prisma.PostGetPayload<{ include: typeof postInclude }>;

/**
 * Who can see a post. Reading a post, its photos, its comments and its likes, and sharing it, all ask this one
 * question, so a post's visibility means the same thing everywhere it appears.
 */
@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly social: SocialService,
    private readonly storage: FileStorage,
  ) {}

  /** The query that matches what this person may see. Feed, profile and single-post reads all start from it. */
  async visibleWhere(viewer: User): Promise<Prisma.PostWhereInput> {
    const [hidden, friends] = await Promise.all([this.social.blockedIds(viewer.id), this.social.friendIds(viewer.id)]);
    return {
      author: { deletedAt: null, suspendedAt: null },
      authorId: { notIn: [...hidden] },
      OR: [{ authorId: viewer.id }, { visibility: "public" }, { visibility: "friends", authorId: { in: [...friends] } }],
    };
  }

  /** The post, or "not found" for anyone who may not see it, so its existence isn't revealed. */
  async visiblePost(viewer: User, postId: string) {
    const post = await this.prisma.post.findFirst({ where: { AND: [{ id: postId }, await this.visibleWhere(viewer)] }, include: postInclude });
    if (!post) throw new NotFoundException({ message: "This post isn't available" });
    return post;
  }

  async canSee(viewer: User, post: Pick<Post, "id">) {
    return (await this.prisma.post.count({ where: { AND: [{ id: post.id }, await this.visibleWhere(viewer)] } })) > 0;
  }

  /** What a viewer gets. A linked trip is named only for people who could see that trip anyway. */
  async toPost(viewer: User, posts: PostRow[]) {
    const liked = new Set((await this.prisma.postLike.findMany({ where: { userId: viewer.id, postId: { in: posts.map((p) => p.id) } }, select: { postId: true } })).map((l) => l.postId));
    return posts.map((p) => {
      const mine = p.authorId === viewer.id;
      const tripVisible = p.trip && (p.trip.visibility === "public" || p.trip.members.some((m) => m.userId === viewer.id));
      return {
        id: p.id,
        author: { id: p.author.id, name: p.author.name, avatar: p.author.avatar, username: p.author.username },
        caption: p.caption,
        destination: p.destination,
        trip: tripVisible && p.trip ? { id: p.trip.id, name: p.trip.name, isMember: p.trip.members.some((m) => m.userId === viewer.id) } : null,
        visibility: mine ? p.visibility : undefined,
        photos: p.photos.map((ph) => fileUrl(ph.fileId)),
        createdAt: p.createdAt.toISOString(),
        edited: !!p.editedAt,
        likeCount: p._count.likes,
        commentCount: p._count.comments,
        likedByMe: liked.has(p.id),
        mine,
      };
    });
  }

  /**
   * A separate copy of a trip photo for a post, so deleting one never affects the other, and the trip's own
   * permissions stay exactly as they were. Photos are already free of location data from when they were uploaded.
   */
  async copyMemoryPhoto(user: User, photoId: string) {
    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
    const membership = photo && (await this.prisma.tripMember.findUnique({ where: { tripId_userId: { tripId: photo.tripId, userId: user.id } } }));
    // Only the person who added a photo can share it. Everyone else's photos stay in the trip.
    if (!photo || photo.authorId !== user.id || membership?.status !== "active" || photo.kind !== "photo") throw new NotFoundException({ message: "That photo can't be shared" });
    const source = await this.prisma.storedFile.findUnique({ where: { id: photo.url.slice("/api/files/".length) } });
    const data = source && (await this.storage.read(source));
    if (!source || !data) throw new NotFoundException({ message: "That photo can't be shared" });
    const storageKey = await this.storage.save(data, source.mimeType);
    const copy = await this.prisma.storedFile.create({
      data: {
        uploadedBy: user.id,
        fileName: source.fileName,
        mimeType: source.mimeType,
        sizeBytes: data.length,
        storageKey,
        metadataClean: source.metadataClean,
        isPublic: false,
        ...(storageKey ? {} : { blob: { create: { data: new Uint8Array(data) } } }),
      },
      select: { id: true },
    });
    return { fileId: copy.id, tripId: photo.tripId };
  }
}
