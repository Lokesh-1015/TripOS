import { randomBytes, randomUUID } from "node:crypto";
import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { z } from "zod";
import { normalizeEmail, DEFAULT_NOTIFY, DEFAULT_PRIVACY } from "../auth/auth.service.js";
import { CurrentUser, Public } from "../auth/session.guard.js";
import { Actor, enforce, RequiresTripRole, TripAccessGuard } from "../authz/trip-access.guard.js";
import { canChangeMemberRole, canDeleteTrip, canEditTrip, canInviteMembers, canRemoveMember } from "../authz/trip-policies.js";
import type { TripActor } from "../authz/trip-roles.js";
import { toMinor } from "../common/money.js";
import { asDate, clientId, imageRef, isoDate, longText, money, parse, shortText, version } from "../common/validation.js";
import type { Prisma, User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { MailService } from "../mail/mail.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { SocialService } from "../social/social.service.js";
import { suggestUsername } from "../social/usernames.js";
import { assertRoom, tellHostsIfFull, tellHostsSomeoneJoined } from "./participants.js";
import { pollBody, pollData } from "./polls.controller.js";
import { assertVerified } from "./state.controller.js";
import { dateString } from "../common/validation.js";
import { tripInclude, toTrip } from "./trip.serializer.js";
import { TripWriter, updateVersioned } from "./trip-writer.service.js";

const name = z.string().trim().min(3).max(120);
const destination = z.string().trim().min(1).max(200);
const maxParticipants = z.number().int().min(1).max(1000);
const publicDetails = { category: z.string().trim().max(40), travelStyle: z.string().trim().max(40), showBudget: z.boolean(), showPlan: z.boolean() };

const createBody = z
  .object({
    id: clientId,
    name,
    destination,
    description: longText.default(""),
    cover: imageRef.refine((v) => v !== "", "Choose a cover image"),
    startDate: isoDate,
    endDate: isoDate,
    flexibleDates: z.boolean().default(false),
    currency: z.string().length(3).default("INR"),
    budget: money.default(0),
    perPersonBudget: money.default(0),
    maxParticipants: maxParticipants.nullable().default(null),
    visibility: z.enum(["private", "public"]).default("private"),
    category: publicDetails.category.default(""),
    travelStyle: publicDetails.travelStyle.default(""),
    showBudget: publicDetails.showBudget.default(false),
    showPlan: publicDetails.showPlan.default(false),
    // Email for new people; id for someone picked from search, friends or past trips, whose emails stay hidden.
    members: z.array(z.object({ email: z.email().optional(), id: z.string().optional() })).max(50).default([]),
    polls: z.array(pollBody).max(5).default([]),
  })
  .refine((t) => t.endDate >= t.startDate, { message: "End date must be on or after the start date", path: ["endDate"] });

const copyBody = z.object({ id: clientId, name, startDate: isoDate });

const patchBody = z.object({
  name: name.optional(),
  destination: destination.optional(),
  description: longText.optional(),
  cover: imageRef.optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  flexibleDates: z.boolean().optional(),
  currency: z.string().length(3).optional(),
  budget: money.optional(),
  perPersonBudget: money.optional(),
  archived: z.boolean().optional(),
  maxParticipants: maxParticipants.nullable().optional(),
  visibility: z.enum(["private", "public"]).optional(),
  category: publicDetails.category.optional(),
  travelStyle: publicDetails.travelStyle.optional(),
  showBudget: publicDetails.showBudget.optional(),
  showPlan: publicDetails.showPlan.optional(),
  highlights: z.array(shortText).max(10).optional(),
  version,
});

// An email address for someone new, or the id of a traveller picked from search, friends or past trips.
const inviteBody = z
  .object({ email: z.email().optional(), userId: z.string().min(1).max(64).optional() })
  .refine((b) => !!b.email !== !!b.userId, { message: "Choose someone to invite" });
const roleBody = z.object({ role: z.enum(["admin", "member", "viewer"]) });

const nameFromEmail = (email: string) =>
  email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const dayCount = (start: string, end: string) => Math.round((asDate(end).getTime() - asDate(start).getTime()) / 86_400_000) + 1;

/**
 * Someone picked by id can be invited when they're findable (a confirmed, set-up account) or have travelled
 * with the inviter. Blocked people, either way, and deleted or suspended accounts can't be.
 */
async function invitableUser(tx: Prisma.TransactionClient, inviterId: string, targetId: string) {
  if (targetId === inviterId) return null;
  const blocked = await tx.block.count({ where: { OR: [{ blockerId: inviterId, blockedId: targetId }, { blockerId: targetId, blockedId: inviterId }] } });
  if (blocked) return null;
  return tx.user.findFirst({
    where: {
      id: targetId,
      deletedAt: null,
      suspendedAt: null,
      OR: [
        { onboarded: true, emailVerifiedAt: { not: null } },
        { memberships: { some: { status: "active", trip: { members: { some: { userId: inviterId, status: "active" } } } } } },
      ],
    },
  });
}

/** An invitee may not have an account yet: the placeholder row is claimed when they sign up. */
async function findOrCreateUser(tx: Prisma.TransactionClient, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  return tx.user.upsert({
    where: { email },
    update: {},
    create: { email, name: nameFromEmail(email), username: await suggestUsername(tx, nameFromEmail(email)), travelStyles: [], savedDestinations: [], notify: DEFAULT_NOTIFY, privacy: DEFAULT_PRIVACY },
  });
}

@Controller("trips")
export class TripsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: TripWriter,
    private readonly realtime: RealtimeGateway,
    private readonly mail: MailService,
    private readonly social: SocialService,
  ) {}

  @Post()
  async create(@CurrentUser() user: User, @Body() body: unknown) {
    const input = parse(createBody, body);
    if (input.members.length) assertVerified(user, "invite people");
    if (input.visibility === "public") {
      assertVerified(user, "host a public trip");
      await this.social.ensureUsername(user);
    }
    if (await this.prisma.trip.findUnique({ where: { id: input.id }, select: { id: true } })) {
      // A retried create must not fail, but must not reveal someone else's trip either.
      const mine = await this.prisma.tripMember.findUnique({ where: { tripId_userId: { tripId: input.id, userId: user.id } } });
      if (!mine) throw new ConflictException({ message: "Please try again" });
      return this.load(input.id, user.id);
    }
    const invited = await this.prisma.$transaction(async (tx) => {
      await tx.trip.create({
        data: {
          id: input.id,
          name: input.name,
          destination: input.destination,
          description: input.description,
          cover: input.cover,
          startDate: asDate(input.startDate),
          endDate: asDate(input.endDate),
          flexibleDates: input.flexibleDates,
          currency: input.currency,
          budgetMinor: toMinor(input.budget),
          perPersonBudgetMinor: toMinor(input.perPersonBudget),
          maxParticipants: input.maxParticipants,
          visibility: input.visibility,
          category: input.category,
          travelStyle: input.travelStyle,
          showBudget: input.showBudget,
          showPlan: input.showPlan,
          highlights: [],
          joinCode: randomBytes(18).toString("base64url"),
          createdById: user.id,
          members: { create: { userId: user.id, role: "owner", status: "active" } },
          events: { create: { actorId: user.id, text: `created the trip “${input.name}”`, kind: "trip" } },
        },
      });
      const people: { id: string; email: string; passwordHash: string | null }[] = [];
      for (const m of input.members) {
        const known = m.id ? await invitableUser(tx, user.id, m.id) : null;
        const invitee = known ?? (m.email ? await findOrCreateUser(tx, m.email) : null);
        if (!invitee || invitee.id === user.id || people.some((p) => p.id === invitee.id)) continue;
        await tx.tripMember.create({ data: { tripId: input.id, userId: invitee.id, role: "member", status: "invited" } });
        await tx.notification.create({ data: inviteNotification(invitee.id, input.id, user.name, input.name) });
        people.push(invitee);
      }
      for (const p of input.polls) await tx.poll.create({ data: pollData(p, input.id, user.id) });
      return people;
    });
    this.realtime.membershipChanged(user.id, input.id, true);
    this.realtime.notificationsChanged(invited.map((p) => p.id));
    invited.forEach((p) => void this.mail.sendTripInvite(p.email, user.name, input.name, !!p.passwordHash));
    return this.load(input.id, user.id);
  }

  @UseGuards(TripAccessGuard)
  @RequiresTripRole("viewer")
  @Get(":tripId")
  get(@Param("tripId") tripId: string, @CurrentUser() user: User) {
    return this.load(tripId, user.id);
  }

  @UseGuards(TripAccessGuard)
  @RequiresTripRole("viewer")
  @Patch(":tripId")
  async patch(@Param("tripId") tripId: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canEditTrip(actor));
    const { version: expected, budget, perPersonBudget, startDate, endDate, ...rest } = parse(patchBody, body);
    if (rest.visibility === "public") {
      assertVerified(user, "host a public trip");
      await this.social.ensureUsername(user);
    }
    await this.writer.run(tripId, user.id, async ({ tx, log, notify, tripName }) => {
      const current = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
      const start = startDate ?? dateString(current.startDate);
      const end = endDate ?? dateString(current.endDate);
      if (end < start) throw new ConflictException({ message: "End date must be on or after the start date" });
      if (rest.maxParticipants != null) {
        // Holds the trip, so nobody can join between counting and saving. A limit never removes anyone.
        await assertRoom(tx, tripId, user.id);
        const joined = await tx.tripMember.count({ where: { tripId, status: "active" } });
        if (rest.maxParticipants < joined) throw new ConflictException({ code: "LIMIT_TOO_LOW", message: `${joined} people have already joined, so the limit can't be lower than that.` });
      }
      const days = dayCount(start, end);
      // Activities are stored by day number, so a shorter trip would strand them where no one can reach them.
      const stranded = await tx.activity.count({ where: { tripId, day: { gte: days } } });
      if (stranded) throw new ConflictException({ message: `${stranded} planned ${stranded === 1 ? "activity is" : "activities are"} after the new end date. Move or delete them first.` });
      if (rest.currency && rest.currency !== current.currency) {
        // Relabelling amounts would silently change what everyone owes.
        const hasMoney = current.budgetMinor > 0 || current.perPersonBudgetMinor > 0 || (await tx.expense.count({ where: { tripId } })) > 0 || (await tx.settlement.count({ where: { tripId } })) > 0 || (await tx.activity.count({ where: { tripId, costMinor: { gt: 0 } } })) > 0;
        if (hasMoney) throw new ConflictException({ message: "This trip already has amounts in it. Convert the currency from the Expenses tab." });
      }
      await updateVersioned(
        { updateMany: (args) => tx.trip.updateMany({ where: { id: tripId, ...(expected === undefined ? {} : { version: expected }) }, data: args.data }) },
        { id: tripId, tripId },
        expected,
        {
          ...rest,
          ...(startDate ? { startDate: asDate(startDate) } : {}),
          ...(endDate ? { endDate: asDate(endDate) } : {}),
          ...(budget === undefined ? {} : { budgetMinor: toMinor(budget) }),
          ...(perPersonBudget === undefined ? {} : { perPersonBudgetMinor: toMinor(perPersonBudget) }),
        },
      );
      if (rest.archived !== undefined && rest.archived !== current.archived) await log(rest.archived ? "archived the trip" : "restored the trip", "trip");
      else if (rest.currency && rest.currency !== current.currency) await log(`switched currency to ${rest.currency}`, "trip");
      else if (rest.visibility && rest.visibility !== current.visibility) {
        await log(rest.visibility === "public" ? "made the trip public" : "made the trip private", "trip");
        await notify({ kind: "trip_visibility", title: rest.visibility === "public" ? `${tripName} is now public` : `${tripName} is now private`, body: rest.visibility === "public" ? "It can now be found in Explore. Your details stay private, and the host decides who joins." : "It no longer appears in Explore. Everyone on it stays.", link: `/app/trips/${tripId}` });
      } else await log("updated trip details", "trip");
    });
    return this.load(tripId, user.id);
  }

  /**
   * Starts a new trip from this one: its plan and packing lists, but nothing about the people or money.
   * Anyone on the trip can do this, and only gets what they can already see.
   */
  @UseGuards(TripAccessGuard)
  @RequiresTripRole("viewer")
  @Post(":tripId/copy")
  async copy(@Param("tripId") tripId: string, @CurrentUser() user: User, @Body() body: unknown) {
    const { id, name, startDate } = parse(copyBody, body);
    if (await this.prisma.trip.findUnique({ where: { id }, select: { id: true } })) {
      const mine = await this.prisma.tripMember.findUnique({ where: { tripId_userId: { tripId: id, userId: user.id } } });
      if (!mine) throw new ConflictException({ message: "Please try again" });
      return this.load(id, user.id);
    }
    const source = await this.prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      include: { activities: { orderBy: [{ day: "asc" }, { position: "asc" }] }, places: { orderBy: { createdAt: "asc" } }, packing: { where: { OR: [{ scope: "shared" }, { assignee: user.id }] }, orderBy: { createdAt: "asc" } } },
    });
    const start = asDate(startDate);
    const end = new Date(start.getTime() + (source.endDate.getTime() - source.startDate.getTime()));
    const placeIds = new Map(source.places.map((p) => [p.id, `pl-${randomUUID()}`]));
    await this.prisma.$transaction(async (tx) => {
      await tx.trip.create({
        data: {
          id,
          name,
          destination: source.destination,
          description: source.description,
          cover: source.cover,
          startDate: start,
          endDate: end,
          flexibleDates: source.flexibleDates,
          currency: source.currency,
          budgetMinor: source.budgetMinor,
          perPersonBudgetMinor: source.perPersonBudgetMinor,
          highlights: [],
          joinCode: randomBytes(18).toString("base64url"),
          createdById: user.id,
          members: { create: { userId: user.id, role: "owner", status: "active" } },
          events: { create: { actorId: user.id, text: `created the trip “${name}” from “${source.name}”`, kind: "trip" } },
        },
      });
      await tx.place.createMany({ data: source.places.map((p) => ({ id: placeIds.get(p.id) as string, tripId: id, name: p.name, type: p.type, lat: p.lat, lng: p.lng, address: p.address, note: p.note })) });
      await tx.activity.createMany({
        data: source.activities.map((a) => ({
          id: `act-${randomUUID()}`,
          tripId: id,
          day: a.day,
          position: a.position,
          type: a.type,
          title: a.title,
          start: a.start,
          end: a.end,
          location: a.location,
          placeId: a.placeId ? placeIds.get(a.placeId) : null,
          description: a.description,
          costMinor: a.costMinor,
          notes: a.notes,
          assignees: [],
        })),
      });
      await tx.packingItem.createMany({ data: source.packing.map((p) => ({ id: `pack-${randomUUID()}`, tripId: id, name: p.name, category: p.category, qty: p.qty, scope: p.scope, assignee: user.id, packed: false })) });
    });
    this.realtime.membershipChanged(user.id, id, true);
    return this.load(id, user.id);
  }

  @UseGuards(TripAccessGuard)
  @RequiresTripRole("viewer")
  @Delete(":tripId")
  async remove(@Param("tripId") tripId: string, @Actor() actor: TripActor) {
    enforce(canDeleteTrip(actor));
    this.realtime.tripDeleted(tripId);
    await this.prisma.trip.delete({ where: { id: tripId } });
    return { ok: true };
  }

  @UseGuards(ThrottlerGuard, TripAccessGuard)
  @Throttle({ default: { ttl: 3_600_000, limit: 100 } })
  @RequiresTripRole("viewer")
  @Post(":tripId/members")
  async invite(@Param("tripId") tripId: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canInviteMembers(actor));
    assertVerified(user, "invite people");
    const { email, userId } = parse(inviteBody, body);
    const invitee = await this.writer.run(tripId, user.id, async ({ tx, log, tripName }) => {
      await assertRoom(tx, tripId);
      const invitee = userId ? await invitableUser(tx, user.id, userId) : await findOrCreateUser(tx, email as string);
      if (!invitee) throw new NotFoundException({ message: "We couldn't find that traveller" });
      const existing = await tx.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: invitee.id } } });
      if (existing && existing.status !== "removed") throw new ConflictException({ message: "This person is already on the trip" });
      await tx.tripMember.upsert({
        where: { tripId_userId: { tripId, userId: invitee.id } },
        update: { status: "invited", role: "member", leftAt: null },
        create: { tripId, userId: invitee.id, role: "member", status: "invited" },
      });
      await tx.notification.create({ data: inviteNotification(invitee.id, tripId, user.name, tripName) });
      await log(`invited ${invitee.name}`, "member");
      return { ...invitee, tripName };
    });
    this.realtime.notificationsChanged([invitee.id]);
    void this.mail.sendTripInvite(invitee.email, user.name, invitee.tripName, !!invitee.passwordHash);
    return this.load(tripId, user.id);
  }

  @UseGuards(TripAccessGuard)
  @RequiresTripRole("viewer")
  @Patch(":tripId/members/:userId")
  async changeRole(@Param("tripId") tripId: string, @Param("userId") userId: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    const { role } = parse(roleBody, body);
    const target = await this.member(tripId, userId);
    enforce(canChangeMemberRole(actor, target, role));
    await this.writer.run(tripId, user.id, async ({ tx }) => {
      await tx.tripMember.update({ where: { tripId_userId: { tripId, userId } }, data: { role } });
    });
    return this.load(tripId, user.id);
  }

  @UseGuards(TripAccessGuard)
  @RequiresTripRole("viewer")
  @Delete(":tripId/members/:userId")
  async removeMember(@Param("tripId") tripId: string, @Param("userId") userId: string, @Actor() actor: TripActor, @CurrentUser() user: User) {
    const target = await this.member(tripId, userId);
    enforce(canRemoveMember(actor, target));
    await this.writer.run(tripId, user.id, async ({ tx, log }) => {
      // The row stays: their expenses and messages must survive, or the group's balances break.
      await tx.tripMember.update({ where: { tripId_userId: { tripId, userId } }, data: { status: "removed", leftAt: null } });
      await tx.tripLeaveRequest.updateMany({ where: { tripId, userId, status: "pending" }, data: { status: "cancelled", respondedAt: new Date() } });
      await tx.notification.deleteMany({ where: { tripId, userId, kind: "invite" } });
      const removed = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
      await log(`removed ${removed.name}`, "member");
    });
    this.realtime.membershipChanged(userId, tripId, false);
    return this.load(tripId, user.id);
  }

  private async member(tripId: string, userId: string): Promise<TripActor> {
    const m = await this.prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId } } });
    if (!m || m.status === "removed") throw new NotFoundException({ message: "That person isn't on this trip" });
    return { userId, tripId, role: m.role, status: m.status };
  }

  private async load(tripId: string, userId: string) {
    return toTrip(await this.prisma.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripInclude }), userId);
  }
}

function inviteNotification(userId: string, tripId: string, inviter: string, tripName: string) {
  return { userId, tripId, kind: "invite" as const, title: `${inviter} invited you to ${tripName}`, body: "Accept to see the plan and start collaborating", link: `/app/trips/${tripId}` };
}

/** "Anyone with the link": the join page previews the trip, then joining needs an account. */
@Controller("invites")
export class InvitesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: TripWriter,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Public()
  @Get(":code")
  async preview(@Param("code") code: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { joinCode: code },
      include: { members: { where: { status: "active" }, include: { user: { select: { id: true, name: true, avatar: true } } } } },
    });
    if (!trip) throw new NotFoundException({ message: "This invite link isn't available" });
    return {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      cover: trip.cover,
      startDate: dateString(trip.startDate),
      endDate: dateString(trip.endDate),
      archived: trip.archived,
      maxParticipants: trip.maxParticipants,
      members: trip.members.map((m) => ({ id: m.user.id, name: m.user.name, avatar: m.user.avatar })),
    };
  }

  @HttpCode(200)
  @Post(":code/accept")
  async accept(@Param("code") code: string, @CurrentUser() user: User) {
    const trip = await this.prisma.trip.findUnique({ where: { joinCode: code }, select: { id: true } });
    if (!trip) throw new NotFoundException({ message: "This invite link isn't available" });
    const existing = await this.prisma.tripMember.findUnique({ where: { tripId_userId: { tripId: trip.id, userId: user.id } } });
    // Someone who left by choice can come back. Someone an admin removed needs to be invited again.
    if (existing?.status === "removed" && !existing.leftAt) throw new ForbiddenException({ message: "You were removed from this trip. Ask an admin to invite you again." });
    if (existing?.status !== "active") {
      await this.writer.run(trip.id, user.id, async (ctx) => {
        const { tx, log } = ctx;
        await assertRoom(tx, trip.id, user.id);
        await tx.tripMember.upsert({
          where: { tripId_userId: { tripId: trip.id, userId: user.id } },
          update: { status: "active", role: "member", leftAt: null },
          create: { tripId: trip.id, userId: user.id, role: "member", status: "active" },
        });
        await tx.notification.deleteMany({ where: { tripId: trip.id, userId: user.id, kind: "invite" } });
        await log("joined via invite link", "member");
        await tellHostsSomeoneJoined(ctx, trip.id, user.name);
        await tellHostsIfFull(ctx, trip.id);
      });
      this.realtime.membershipChanged(user.id, trip.id, true);
    }
    return toTrip(await this.prisma.trip.findUniqueOrThrow({ where: { id: trip.id }, include: tripInclude }), user.id);
  }
}
