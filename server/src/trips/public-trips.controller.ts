import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { z } from "zod";
import { AllowUnconfirmed, CurrentUser, Public } from "../auth/session.guard.js";
import { Actor, enforce, RequiresTripRole, TripAccessGuard } from "../authz/trip-access.guard.js";
import { canInviteMembers } from "../authz/trip-policies.js";
import type { TripActor } from "../authz/trip-roles.js";
import { fromMinor, toMinor } from "../common/money.js";
import { asDate, dateString, isoDate, parse } from "../common/validation.js";
import type { JoinRequest, Prisma, User } from "../generated/prisma/client.js";
import { MailService } from "../mail/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { SocialService } from "../social/social.service.js";
import { assertRoom, tellHostsIfFull } from "./participants.js";
import { assertVerified } from "./state.controller.js";
import { TripWriter } from "./trip-writer.service.js";

const PAGE = 24;
const SCAN = 300;

const listQuery = z.object({
  destination: z.string().trim().max(100).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  budgetMax: z.coerce.number().positive().max(100_000_000).optional(),
  currency: z.string().length(3).optional(),
  category: z.string().max(40).optional(),
  style: z.string().max(40).optional(),
  minDays: z.coerce.number().int().min(1).max(366).optional(),
  maxDays: z.coerce.number().int().min(1).max(366).optional(),
  minPeople: z.coerce.number().int().min(1).max(1000).optional(),
  maxPeople: z.coerce.number().int().min(1).max(1000).optional(),
  available: z.enum(["true", "false"]).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
const requestBody = z.object({ message: z.string().trim().max(500).default("") });

const publicInclude = {
  members: { where: { status: "active" }, select: { userId: true, role: true, user: true } },
  activities: { orderBy: [{ day: "asc" }, { start: "asc" }], select: { day: true, title: true, type: true, start: true } },
} satisfies Prisma.TripInclude;
type PublicRow = Prisma.TripGetPayload<{ include: typeof publicInclude }>;

const dayCount = (t: { startDate: Date; endDate: Date }) => Math.round((t.endDate.getTime() - t.startDate.getTime()) / 86_400_000) + 1;
const today = () => asDate(new Date().toISOString().slice(0, 10));

/**
 * What anyone may see of a public trip. Each field is named here, so nothing else on a trip can reach this
 * response by accident: no join link, members' names, addresses, notes, expenses, documents or chat.
 */
function toPublicTrip(t: PublicRow) {
  const owner = t.members.find((m) => m.role === "owner");
  const joined = t.members.length;
  return {
    id: t.id,
    title: t.name,
    destination: t.destination,
    cover: t.cover,
    description: t.description,
    startDate: dateString(t.startDate),
    endDate: dateString(t.endDate),
    flexibleDates: t.flexibleDates,
    days: dayCount(t),
    category: t.category,
    travelStyle: t.travelStyle,
    participantCount: joined,
    maxParticipants: t.maxParticipants,
    placesLeft: t.maxParticipants == null ? null : Math.max(0, t.maxParticipants - joined),
    full: t.maxParticipants != null && joined >= t.maxParticipants,
    budgetPerPerson: t.showBudget && t.perPersonBudgetMinor > 0 ? fromMinor(t.perPersonBudgetMinor) : null,
    currency: t.showBudget ? t.currency : null,
    plan: t.showPlan ? t.activities.map((a) => ({ day: a.day, title: a.title, type: a.type })) : [],
    hostUserId: owner?.userId,
  };
}

/** Public trips, and requests to join them. Visibility makes a trip findable: only the host's approval adds anyone. */
@UseGuards(ThrottlerGuard)
@Controller()
export class PublicTripsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: TripWriter,
    private readonly social: SocialService,
    private readonly realtime: RealtimeGateway,
    private readonly mail: MailService,
  ) {}

  /** A public trip that's still to come, whose host hasn't been suspended or deleted. */
  private liveWhere(): Prisma.TripWhereInput {
    return { visibility: "public", archived: false, endDate: { gte: today() }, members: { some: { role: "owner", status: "active", user: { deletedAt: null, suspendedAt: null } } } };
  }

  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get("public/trips")
  async list(@CurrentUser() user: User, @Query() query: unknown) {
    const q = parse(listQuery, query);
    const where: Prisma.TripWhereInput = { ...this.liveWhere() };
    if (q.destination) where.OR = [{ destination: { contains: q.destination, mode: "insensitive" } }, { name: { contains: q.destination, mode: "insensitive" } }];
    if (q.month) {
      const start = asDate(`${q.month}-01`);
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
      where.AND = [{ startDate: { lte: end } }, { endDate: { gte: start } }];
    }
    if (q.from) where.startDate = { ...(where.startDate as object | undefined), gte: asDate(q.from) };
    if (q.to) where.endDate = { gte: today(), lte: asDate(q.to) };
    if (q.category) where.category = q.category;
    if (q.style) where.travelStyle = q.style;
    if (q.budgetMax) Object.assign(where, { showBudget: true, perPersonBudgetMinor: { gt: 0, lte: toMinor(q.budgetMax) }, ...(q.currency ? { currency: q.currency } : {}) });

    const blocked = await this.social.blockedIds(user.id);
    const rows = await this.prisma.trip.findMany({ where, include: publicInclude, orderBy: [{ startDate: "asc" }, { id: "asc" }], take: SCAN });
    const shown = rows.filter((t) => {
      const host = t.members.find((m) => m.role === "owner");
      if (!host || blocked.has(host.userId)) return false;
      const days = dayCount(t);
      if (q.minDays && days < q.minDays) return false;
      if (q.maxDays && days > q.maxDays) return false;
      if (q.minPeople && t.members.length < q.minPeople) return false;
      if (q.maxPeople && t.members.length > q.maxPeople) return false;
      if (q.available === "true" && t.maxParticipants != null && t.members.length >= t.maxParticipants) return false;
      return true;
    });
    const page = shown.slice(q.offset, q.offset + PAGE);
    return {
      trips: await Promise.all(page.map((t) => this.withHost(t, user))),
      hasMore: shown.length > q.offset + PAGE,
    };
  }

  private async withHost(t: PublicRow, viewer: User | undefined) {
    const { hostUserId, ...trip } = toPublicTrip(t);
    const host = t.members.find((m) => m.userId === hostUserId)?.user;
    if (!host) throw new NotFoundException({ message: "This trip isn't available" });
    // Someone signed out sees only a first name and photo. Profiles are for people with an account.
    if (!viewer) return { ...trip, host: { name: host.name.split(" ")[0], avatar: host.avatar, username: null, id: null } };
    return { ...trip, host: { name: host.name, avatar: host.avatar, username: host.username, id: host.id } };
  }

  /** How this person relates to the trip, which decides what the page offers them. */
  private async viewerState(tripId: string, viewer: User | undefined) {
    if (!viewer) return { state: "signed_out" as const };
    const [member, request] = await Promise.all([
      this.prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: viewer.id } }, select: { status: true, role: true } }),
      this.prisma.joinRequest.findUnique({ where: { tripId_userId: { tripId, userId: viewer.id } } }),
    ]);
    if (member?.status === "active") return { state: member.role === "owner" || member.role === "admin" ? ("host" as const) : ("member" as const) };
    if (member?.status === "invited") return { state: "invited" as const };
    if (member?.status === "removed") return { state: "removed" as const };
    if (request?.status === "pending") return { state: "pending" as const };
    if (request?.status === "rejected") return { state: "rejected" as const };
    return { state: "none" as const };
  }

  /** Viewable without an account, so a trip can be shared by link. Anything else about the trip stays behind membership. */
  @Public()
  @AllowUnconfirmed()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get("public/trips/:id")
  async detail(@CurrentUser() user: User | undefined, @Param("id") id: string) {
    const trip = await this.prisma.trip.findFirst({ where: { id, ...this.liveWhere() }, include: publicInclude });
    if (!trip) throw new NotFoundException({ message: "This trip isn't available" });
    const hostId = trip.members.find((m) => m.role === "owner")?.userId as string;
    if (user && (await this.social.isBlockedEitherWay(user.id, hostId))) throw new NotFoundException({ message: "This trip isn't available" });
    return { ...(await this.withHost(trip, user)), viewer: await this.viewerState(id, user) };
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post("public/trips/:id/join-request")
  async request(@CurrentUser() user: User, @Param("id") id: string, @Body() body: unknown) {
    assertVerified(user, "ask to join a trip");
    const { message } = parse(requestBody, body ?? {});
    const trip = await this.prisma.trip.findFirst({ where: { id, ...this.liveWhere() }, include: publicInclude });
    if (!trip) throw new NotFoundException({ message: "This trip isn't available" });
    const hostId = trip.members.find((m) => m.role === "owner")?.userId as string;
    if (await this.social.isBlockedEitherWay(user.id, hostId)) throw new NotFoundException({ message: "This trip isn't available" });
    const { state } = await this.viewerState(id, user);
    if (state === "host" || state === "member") throw new ConflictException({ message: "You're already on this trip" });
    if (state === "invited") throw new ConflictException({ message: "You've already been invited. Check your notifications to accept." });
    if (state === "removed") throw new ForbiddenException({ message: "You were removed from this trip, so you can't ask to join again." });
    if (state === "pending") throw new ConflictException({ message: "You've already asked to join. The host will decide soon." });
    if (state === "rejected") throw new ConflictException({ message: "The host has already answered your request." });
    if (trip.maxParticipants != null && trip.members.length >= trip.maxParticipants) throw new ConflictException({ code: "TRIP_FULL", message: "This trip is full right now." });

    await this.writer.run(id, user.id, async ({ tx, notify, tripName }) => {
      await tx.joinRequest.upsert({ where: { tripId_userId: { tripId: id, userId: user.id } }, update: { status: "pending", message, createdAt: new Date(), respondedAt: null }, create: { tripId: id, userId: user.id, message } });
      const hosts = trip.members.filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.userId);
      await notify({ kind: "join_request", title: `${user.name} asked to join ${tripName}`, body: message || "Have a look at their request", link: `/app/trips/${id}?requests=1`, to: hosts, collapseUnread: true });
    });
    return { ok: true, state: "pending" };
  }

  @Delete("public/trips/:id/join-request")
  async cancel(@CurrentUser() user: User, @Param("id") id: string) {
    await this.prisma.joinRequest.updateMany({ where: { tripId: id, userId: user.id, status: "pending" }, data: { status: "cancelled", respondedAt: new Date() } });
    this.realtime.tripChanged(id);
    return { ok: true };
  }

  @UseGuards(TripAccessGuard)
  @RequiresTripRole("viewer")
  @Get("trips/:tripId/join-requests")
  async hostList(@Param("tripId") tripId: string, @Actor() actor: TripActor, @CurrentUser() user: User) {
    enforce(canInviteMembers(actor));
    const rows = await this.prisma.joinRequest.findMany({ where: { tripId, status: { in: ["pending", "accepted", "rejected"] } }, orderBy: { createdAt: "desc" }, take: 200 });
    const people = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) }, deletedAt: null, suspendedAt: null } });
    const withUsernames = await Promise.all(people.map((p) => this.social.ensureUsername(p)));
    const cards = new Map((await this.social.cards(user, withUsernames)).map((c) => [c.id, c]));
    const shape = (status: JoinRequest["status"]) => rows.filter((r) => r.status === status).flatMap((r) => {
      const person = cards.get(r.userId);
      return person ? [{ id: r.id, message: r.message, at: r.createdAt.toISOString(), person }] : [];
    });
    return { pending: shape("pending"), accepted: shape("accepted"), rejected: shape("rejected") };
  }

  /** In-app always. Email only if they've opted in, as this is one of the few messages that can't wait. */
  private async tellRequester(userId: string, title: string, body: string, tripId: string, accepted: boolean) {
    await this.social.notify(userId, { kind: accepted ? "join_accepted" : "join_rejected", title, body, link: accepted ? `/app/trips/${tripId}` : `/app/explore/${tripId}` }, tripId);
    const person = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, notify: true, emailVerifiedAt: true } });
    if (person?.emailVerifiedAt && (person.notify as Record<string, boolean>).emailAlerts === true) {
      void this.mail.sendSummary(person.email, title, [body], { label: "Open TripOS", path: accepted ? `/app/trips/${tripId}` : "/app/explore" });
    }
  }

  private async pending(tripId: string, id: string) {
    const request = await this.prisma.joinRequest.findFirst({ where: { id, tripId, status: "pending" } });
    if (!request) throw new NotFoundException({ message: "That request is no longer waiting" });
    return request;
  }

  @UseGuards(TripAccessGuard)
  @RequiresTripRole("viewer")
  @HttpCode(200)
  @Post("trips/:tripId/join-requests/:id/accept")
  async accept(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User) {
    enforce(canInviteMembers(actor));
    const request = await this.pending(tripId, id);
    const person = await this.prisma.user.findUnique({ where: { id: request.userId }, select: { name: true, deletedAt: true, suspendedAt: true } });
    if (!person || person.deletedAt || person.suspendedAt) throw new NotFoundException({ message: "That request is no longer waiting" });
    const tripName = await this.writer.run(tripId, user.id, async (ctx) => {
      const { tx, log } = ctx;
      // The same rule as every other way of joining. If the last place has gone, the host is told here.
      await assertRoom(tx, tripId, request.userId);
      await tx.tripMember.upsert({ where: { tripId_userId: { tripId, userId: request.userId } }, update: { status: "active", role: "member" }, create: { tripId, userId: request.userId, role: "member", status: "active" } });
      await tx.joinRequest.update({ where: { id }, data: { status: "accepted", respondedAt: new Date() } });
      await log(`accepted ${person.name}'s request to join`, "member");
      await tellHostsIfFull(ctx, tripId);
      return ctx.tripName;
    });
    this.realtime.membershipChanged(request.userId, tripId, true);
    await this.tellRequester(request.userId, `You're in! ${user.name.split(" ")[0]} accepted you on ${tripName}`, "Open the trip to see the plan and say hello.", tripId, true);
    return { ok: true };
  }

  @UseGuards(TripAccessGuard)
  @RequiresTripRole("viewer")
  @HttpCode(200)
  @Post("trips/:tripId/join-requests/:id/reject")
  async reject(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor) {
    enforce(canInviteMembers(actor));
    const request = await this.pending(tripId, id);
    await this.prisma.joinRequest.update({ where: { id }, data: { status: "rejected", respondedAt: new Date() } });
    const trip = await this.prisma.trip.findUniqueOrThrow({ where: { id: tripId }, select: { name: true } });
    await this.tellRequester(request.userId, `Your request to join ${trip.name} wasn't accepted`, "There are plenty more trips to discover in Explore.", tripId, false);
    return { ok: true };
  }

  /** Friendly suggestions from what people have in common. Never ordered by popularity. */
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get("people/suggested")
  async suggested(@CurrentUser() user: User) {
    return this.social.suggestions(user);
  }
}
