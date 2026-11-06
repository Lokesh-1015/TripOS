import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, UnprocessableEntityException, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { z } from "zod";
import { CurrentUser } from "../auth/session.guard.js";
import { imageRef, parse } from "../common/validation.js";
import type { Prisma, User } from "../generated/prisma/client.js";
import { MailService } from "../mail/mail.service.js";
import { PostsService } from "../posts/posts.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { assertVerified } from "../trips/state.controller.js";
import { listed, pair, RESERVED_USERNAMES, SocialService, USERNAME } from "./social.service.js";

const tagList = z.array(z.string().trim().min(1).max(60)).max(30);
const profileBody = z.object({
  username: z.string().trim().toLowerCase().regex(USERNAME, "Use 3 to 30 lowercase letters, numbers or underscores").optional(),
  location: z.string().trim().max(100).optional(),
  coverPhoto: imageRef.optional(),
  interests: tagList.optional(),
  favouriteDestinations: tagList.optional(),
  placesVisited: tagList.optional(),
  profileVisibility: z.enum(["public", "private"]).optional(),
  friendRequestsFrom: z.enum(["everyone", "nobody"]).optional(),
});
const searchQuery = z.object({ q: z.string().trim().min(2).max(60) });
const requestBody = z.object({ username: z.string().trim().min(1).max(30) });
const userBody = z.object({ userId: z.string().min(1).max(64) });
const reportBody = z.object({
  targetType: z.enum(["profile", "trip", "post"]),
  targetId: z.string().min(1).max(64),
  reason: z.enum(["spam", "harassment", "fake", "inappropriate", "other"]),
  details: z.string().trim().max(1000).default(""),
});

/** Traveller profiles, friends, blocking and reporting. None of it gives anyone access to a trip. */
@Controller()
export class SocialController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly social: SocialService,
    private readonly realtime: RealtimeGateway,
    private readonly mail: MailService,
    private readonly posts: PostsService,
  ) {}

  private async own(user: User) {
    const me = await this.social.ensureUsername(user);
    return {
      ...(await this.social.profile(me, me)),
      friendRequestsFrom: me.friendRequestsFrom,
      emailVerified: !!me.emailVerifiedAt,
      isAdmin: this.social.isAdmin(me),
    };
  }

  @Get("me/profile")
  ownProfile(@CurrentUser() user: User) {
    return this.own(user);
  }

  @Patch("me/profile")
  async updateProfile(@CurrentUser() user: User, @Body() body: unknown) {
    const patch = parse(profileBody, body);
    if (patch.username && patch.username !== user.username) {
      if (RESERVED_USERNAMES.has(patch.username)) throw new ConflictException({ message: "That username isn't available" });
      if (await this.prisma.user.findUnique({ where: { username: patch.username }, select: { id: true } })) throw new ConflictException({ message: "That username isn't available" });
    }
    return this.own(await this.prisma.user.update({ where: { id: user.id }, data: patch }));
  }

  @Get("profiles/:username")
  async profile(@CurrentUser() user: User, @Param("username") username: string) {
    return this.social.profile(user, await this.social.findVisible(user, username));
  }

  /** Search by name or username. It never matches on an email address, so it can't reveal who has an account. */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get("people/search")
  async search(@CurrentUser() user: User, @Query() query: unknown) {
    const { q } = parse(searchQuery, query);
    const hidden = [...(await this.social.blockedIds(user.id)), user.id];
    const where: Prisma.UserWhereInput = {
      ...listed,
      id: { notIn: hidden },
      OR: [{ name: { contains: q, mode: "insensitive" } }, { username: { startsWith: q.toLowerCase() } }],
    };
    return this.social.cards(user, await this.prisma.user.findMany({ where, orderBy: { name: "asc" }, take: 20 }));
  }

  @Get("friends")
  async friends(@CurrentUser() user: User) {
    const ids = [...(await this.social.friendIds(user.id))];
    return this.social.cards(user, await this.prisma.user.findMany({ where: { id: { in: ids }, deletedAt: null, suspendedAt: null }, orderBy: { name: "asc" } }));
  }

  @Get("friends/requests")
  async requests(@CurrentUser() user: User) {
    const rows = await this.prisma.friendship.findMany({ where: { status: { in: ["pending", "declined"] }, OR: [{ userLowId: user.id }, { userHighId: user.id }] }, orderBy: { createdAt: "desc" }, take: 200 });
    const otherId = (f: { userLowId: string; userHighId: string }) => (f.userLowId === user.id ? f.userHighId : f.userLowId);
    const people = await this.prisma.user.findMany({ where: { id: { in: rows.map(otherId) }, deletedAt: null, suspendedAt: null } });
    const cards = new Map((await this.social.cards(user, people)).map((c) => [c.id, c]));
    const list = (filter: (f: (typeof rows)[number]) => boolean) => rows.filter(filter).flatMap((f) => {
      const person = cards.get(otherId(f));
      return person ? [{ id: f.id, at: f.createdAt.toISOString(), person }] : [];
    });
    return {
      incoming: list((f) => f.status === "pending" && f.requesterId !== user.id),
      sent: list((f) => f.status === "pending" && f.requesterId === user.id),
      declined: list((f) => f.status === "declined" && f.requesterId !== user.id),
    };
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post("friends/requests")
  async sendRequest(@CurrentUser() user: User, @Body() body: unknown) {
    assertVerified(user, "send friend requests");
    const target = await this.social.findVisible(user, parse(requestBody, body).username);
    if (target.id === user.id) throw new UnprocessableEntityException({ message: "That's you" });
    const ids = pair(user.id, target.id);
    const existing = await this.prisma.friendship.findUnique({ where: { userLowId_userHighId: ids } });
    if (existing?.status === "accepted") throw new ConflictException({ message: "You're already friends" });
    if (existing?.status === "pending" && existing.requesterId === user.id) throw new ConflictException({ message: "You've already sent a request" });
    // They asked first, or this person declined and changed their mind: either way both now want it.
    if (existing && existing.requesterId !== user.id) return this.accept(user, existing.id);
    if (existing?.status === "declined" && !this.social.canResendAfterDecline(existing)) throw new ConflictException({ message: "You can't send another request to this traveller yet" });
    if (target.friendRequestsFrom === "nobody") throw new ForbiddenException({ message: "This traveller isn't accepting friend requests" });

    const data = { requesterId: user.id, status: "pending" as const, respondedAt: null, createdAt: new Date() };
    const friendship = existing ? await this.prisma.friendship.update({ where: { id: existing.id }, data }) : await this.prisma.friendship.create({ data: { ...ids, ...data } });
    await this.social.notify(target.id, { kind: "friend_request", title: `${user.name} sent you a friend request`, body: "Have a look at their profile and decide", link: this.social.requestLink(user.id) });
    return { id: friendship.id, relationship: "request_sent" };
  }

  private async answerable(user: User, id: string) {
    const friendship = await this.prisma.friendship.findUnique({ where: { id } });
    const mine = friendship && (friendship.userLowId === user.id || friendship.userHighId === user.id);
    if (!friendship || !mine || friendship.requesterId === user.id || friendship.status === "accepted") throw new NotFoundException({ message: "That request is no longer available" });
    return friendship;
  }

  @HttpCode(200)
  @Post("friends/requests/:id/accept")
  async accept(@CurrentUser() user: User, @Param("id") id: string) {
    assertVerified(user, "accept friend requests");
    const friendship = await this.answerable(user, id);
    await this.prisma.friendship.update({ where: { id }, data: { status: "accepted", respondedAt: new Date() } });
    await this.social.forgetRequestNotification(user.id, friendship.requesterId);
    await this.social.notify(friendship.requesterId, { kind: "friend_accept", title: `${user.name} accepted your friend request`, body: "You can now see each other's friends-only details", link: `/app/u/${(await this.social.ensureUsername(user)).username}` });
    return { id, relationship: "friends" };
  }

  @HttpCode(200)
  @Post("friends/requests/:id/decline")
  async decline(@CurrentUser() user: User, @Param("id") id: string) {
    const friendship = await this.answerable(user, id);
    await this.prisma.friendship.update({ where: { id }, data: { status: "declined", respondedAt: new Date() } });
    await this.social.forgetRequestNotification(user.id, friendship.requesterId);
    return { id, relationship: "none" };
  }

  /** The sender changing their mind. */
  @Delete("friends/requests/:id")
  async cancel(@CurrentUser() user: User, @Param("id") id: string) {
    const friendship = await this.prisma.friendship.findUnique({ where: { id } });
    if (!friendship || friendship.requesterId !== user.id || friendship.status !== "pending") throw new NotFoundException({ message: "That request is no longer available" });
    await this.prisma.friendship.delete({ where: { id } });
    await this.social.forgetRequestNotification(friendship.userLowId === user.id ? friendship.userHighId : friendship.userLowId, user.id);
    return { ok: true };
  }

  @Delete("friends/:userId")
  async remove(@CurrentUser() user: User, @Param("userId") userId: string) {
    await this.prisma.friendship.deleteMany({ where: { ...pair(user.id, userId), status: "accepted" } });
    return { ok: true };
  }

  @Get("blocks")
  async blocks(@CurrentUser() user: User) {
    const rows = await this.prisma.block.findMany({ where: { blockerId: user.id }, orderBy: { createdAt: "desc" }, include: { blocked: { select: { id: true, name: true, avatar: true, username: true } } } });
    return rows.map((b) => b.blocked);
  }

  /** Ends the friendship and any requests, and hides each person from the other. Trips they share aren't changed. */
  @HttpCode(200)
  @Post("blocks")
  async block(@CurrentUser() user: User, @Body() body: unknown) {
    const { userId } = parse(userBody, body);
    if (userId === user.id) throw new UnprocessableEntityException({ message: "That's you" });
    if (!(await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw new NotFoundException({ message: "We couldn't find that traveller" });
    const hostedBy = (hostId: string) => ({ trip: { members: { some: { userId: hostId, role: "owner" as const } } } });
    await this.prisma.$transaction([
      this.prisma.block.upsert({ where: { blockerId_blockedId: { blockerId: user.id, blockedId: userId } }, update: {}, create: { blockerId: user.id, blockedId: userId } }),
      this.prisma.friendship.deleteMany({ where: pair(user.id, userId) }),
      this.prisma.joinRequest.updateMany({ where: { status: "pending", OR: [{ userId, ...hostedBy(user.id) }, { userId: user.id, ...hostedBy(userId) }] }, data: { status: "cancelled", respondedAt: new Date() } }),
    ]);
    await this.social.forgetRequestNotification(user.id, userId);
    await this.social.forgetRequestNotification(userId, user.id);
    return { ok: true };
  }

  @Delete("blocks/:userId")
  async unblock(@CurrentUser() user: User, @Param("userId") userId: string) {
    await this.prisma.block.deleteMany({ where: { blockerId: user.id, blockedId: userId } });
    return { ok: true };
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  @Post("reports")
  async report(@CurrentUser() user: User, @Body() body: unknown) {
    const input = parse(reportBody, body);
    if (input.targetType === "post") {
      const post = await this.prisma.post.findUnique({ where: { id: input.targetId }, select: { id: true, caption: true, authorId: true } });
      if (!post || post.authorId === user.id || !(await this.posts.canSee(user, post))) throw new NotFoundException({ message: "This post isn't available" });
      await this.prisma.report.create({ data: { reporterId: user.id, ...input } });
      void this.mail.sendToOwner("A post was reported on TripOS", [`A post was reported for: ${input.reason}.`, `Its caption: ${post.caption || "(no caption)"}`, input.details || "No details were given.", "Open the reports page in TripOS to review it."]);
      return { ok: true };
    }
    if (input.targetType === "trip") {
      // Only something this person can actually see, so reporting can't confirm that a private trip exists.
      const trip = await this.prisma.trip.findFirst({ where: { id: input.targetId, visibility: "public" }, select: { id: true, name: true } });
      if (!trip) throw new NotFoundException({ message: "This trip isn't available" });
      await this.prisma.report.create({ data: { reporterId: user.id, ...input } });
      void this.mail.sendToOwner("A trip was reported on TripOS", [`The public trip "${trip.name}" was reported for: ${input.reason}.`, input.details || "No details were given.", "Open the reports page in TripOS to review it."]);
      return { ok: true };
    }
    const target = await this.prisma.user.findUnique({ where: { id: input.targetId }, select: { id: true, username: true, name: true } });
    if (!target || target.id === user.id) throw new NotFoundException({ message: "We couldn't find that traveller" });
    await this.prisma.report.create({ data: { reporterId: user.id, ...input } });
    void this.mail.sendToOwner("A traveller was reported on TripOS", [`${target.name} (@${target.username ?? "no username"}) was reported for: ${input.reason}.`, input.details || "No details were given.", "Open the reports page in TripOS to review it."]);
    return { ok: true };
  }

  private assertAdmin(user: User) {
    // The same answer as a page that doesn't exist, so this reveals nothing.
    if (!this.social.isAdmin(user)) throw new NotFoundException();
  }

  @Get("admin/reports")
  async adminReports(@CurrentUser() user: User) {
    this.assertAdmin(user);
    const reports = await this.prisma.report.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 });
    const people = await this.prisma.user.findMany({ where: { id: { in: reports.flatMap((r) => [r.reporterId, r.targetId]) } }, select: { id: true, name: true, username: true, suspendedAt: true } });
    const byId = new Map(people.map((p) => [p.id, p]));
    const trips = await this.prisma.trip.findMany({ where: { id: { in: reports.filter((r) => r.targetType === "trip").map((r) => r.targetId) } }, select: { id: true, name: true, visibility: true } });
    const tripById = new Map(trips.map((t) => [t.id, t]));
    const posts = await this.prisma.post.findMany({ where: { id: { in: reports.filter((r) => r.targetType === "post").map((r) => r.targetId) } }, select: { id: true, caption: true, author: { select: { name: true } } } });
    const postById = new Map(posts.map((p) => [p.id, p]));
    return reports.map((r) => ({
      id: r.id,
      targetType: r.targetType,
      trip: r.targetType === "trip" ? { id: r.targetId, name: tripById.get(r.targetId)?.name ?? "A deleted trip", isPublic: tripById.get(r.targetId)?.visibility === "public" } : undefined,
      post: r.targetType === "post" ? { id: r.targetId, exists: postById.has(r.targetId), caption: postById.get(r.targetId)?.caption ?? "", author: postById.get(r.targetId)?.author.name ?? "" } : undefined,
      reason: r.reason,
      details: r.details,
      status: r.status,
      at: r.createdAt.toISOString(),
      reporter: byId.get(r.reporterId)?.name ?? "Someone",
      target: { id: r.targetId, name: byId.get(r.targetId)?.name ?? "Unknown", username: byId.get(r.targetId)?.username ?? null, suspended: !!byId.get(r.targetId)?.suspendedAt },
    }));
  }

  @HttpCode(200)
  @Post("admin/reports/:id/review")
  async reviewed(@CurrentUser() user: User, @Param("id") id: string) {
    this.assertAdmin(user);
    await this.prisma.report.update({ where: { id }, data: { status: "reviewed" } });
    return { ok: true };
  }

  /** Takes a trip out of Explore. It carries on as a private trip for the people on it. */
  @HttpCode(200)
  @Post("admin/trips/:id/unpublish")
  async unpublish(@CurrentUser() user: User, @Param("id") id: string) {
    this.assertAdmin(user);
    await this.prisma.trip.update({ where: { id }, data: { visibility: "private" } });
    this.realtime.tripChanged(id);
    return { ok: true };
  }

  /** Signs someone out everywhere and hides them. Their trips and the group's records stay. */
  @HttpCode(200)
  @Post("admin/users/:id/suspend")
  async suspend(@CurrentUser() user: User, @Param("id") id: string) {
    this.assertAdmin(user);
    if (id === user.id) throw new UnprocessableEntityException({ message: "That's you" });
    await this.prisma.$transaction([this.prisma.user.update({ where: { id }, data: { suspendedAt: new Date() } }), this.prisma.session.deleteMany({ where: { userId: id } })]);
    this.realtime.disconnectUser(id);
    return { ok: true };
  }

  @HttpCode(200)
  @Post("admin/users/:id/unsuspend")
  async unsuspend(@CurrentUser() user: User, @Param("id") id: string) {
    this.assertAdmin(user);
    await this.prisma.user.update({ where: { id }, data: { suspendedAt: null } });
    return { ok: true };
  }
}
