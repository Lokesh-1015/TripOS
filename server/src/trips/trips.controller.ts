import { randomBytes } from "node:crypto";
import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
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
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { pollBody, pollData } from "./polls.controller.js";
import { dateString } from "../common/validation.js";
import { tripInclude, toTrip } from "./trip.serializer.js";
import { TripWriter, updateVersioned } from "./trip-writer.service.js";

const name = z.string().trim().min(3).max(120);
const destination = z.string().trim().min(1).max(200);

const createBody = z
  .object({
    id: clientId,
    name,
    destination,
    description: longText.default(""),
    cover: imageRef.default(""),
    startDate: isoDate,
    endDate: isoDate,
    flexibleDates: z.boolean().default(false),
    currency: z.string().length(3).default("INR"),
    budget: money.default(0),
    perPersonBudget: money.default(0),
    // Email for new people; id for "quick add from past trips", whose emails may be hidden.
    members: z.array(z.object({ email: z.email().optional(), id: z.string().optional() })).max(50).default([]),
    polls: z.array(pollBody).max(5).default([]),
  })
  .refine((t) => t.endDate >= t.startDate, { message: "End date must be on or after the start date", path: ["endDate"] });

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
  highlights: z.array(shortText).max(10).optional(),
  version,
});

const inviteBody = z.object({ email: z.email() });
const roleBody = z.object({ role: z.enum(["admin", "member", "viewer"]) });

const nameFromEmail = (email: string) =>
  email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const dayCount = (start: string, end: string) => Math.round((asDate(end).getTime() - asDate(start).getTime()) / 86_400_000) + 1;

/** An invitee may not have an account yet: the placeholder row is claimed when they sign up. */
async function findOrCreateUser(tx: Prisma.TransactionClient, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  return tx.user.upsert({
    where: { email },
    update: {},
    create: { email, name: nameFromEmail(email), travelStyles: [], savedDestinations: [], notify: DEFAULT_NOTIFY, privacy: DEFAULT_PRIVACY },
  });
}

@Controller("trips")
export class TripsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: TripWriter,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Post()
  async create(@CurrentUser() user: User, @Body() body: unknown) {
    const input = parse(createBody, body);
    if (await this.prisma.trip.findUnique({ where: { id: input.id }, select: { id: true } })) {
      // A retried create must not fail, but must not reveal someone else's trip either.
      const mine = await this.prisma.tripMember.findUnique({ where: { tripId_userId: { tripId: input.id, userId: user.id } } });
      if (!mine) throw new ConflictException({ message: "Please try again" });
      return this.load(input.id, user.id);
    }
    const invitedIds = await this.prisma.$transaction(async (tx) => {
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
          highlights: [],
          joinCode: randomBytes(18).toString("base64url"),
          createdById: user.id,
          members: { create: { userId: user.id, role: "owner", status: "active" } },
          events: { create: { actorId: user.id, text: `created the trip “${input.name}”`, kind: "trip" } },
        },
      });
      const ids: string[] = [];
      for (const m of input.members) {
        // Quick add only reaches people the caller has actually travelled with.
        const known = m.id ? await tx.user.findFirst({ where: { id: m.id, memberships: { some: { status: "active", trip: { members: { some: { userId: user.id, status: "active" } } } } } } }) : null;
        const invitee = known ?? (m.email ? await findOrCreateUser(tx, m.email) : null);
        if (!invitee || invitee.id === user.id || ids.includes(invitee.id)) continue;
        await tx.tripMember.create({ data: { tripId: input.id, userId: invitee.id, role: "member", status: "invited" } });
        await tx.notification.create({ data: inviteNotification(invitee.id, input.id, user.name, input.name) });
        ids.push(invitee.id);
      }
      for (const p of input.polls) await tx.poll.create({ data: pollData(p, input.id, user.id) });
      return ids;
    });
    this.realtime.membershipChanged(user.id, input.id, true);
    this.realtime.notificationsChanged(invitedIds);
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
    await this.writer.run(tripId, user.id, async ({ tx, log }) => {
      const current = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
      const start = startDate ?? dateString(current.startDate);
      const end = endDate ?? dateString(current.endDate);
      if (end < start) throw new ConflictException({ message: "End date must be on or after the start date" });
      const days = dayCount(start, end);
      // Activities are stored by day number, so a shorter trip would strand them where no one can reach them.
      const stranded = await tx.activity.count({ where: { tripId, day: { gte: days } } });
      if (stranded) throw new ConflictException({ message: `${stranded} planned ${stranded === 1 ? "activity is" : "activities are"} after the new end date. Move or delete them first.` });
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
      else await log("updated trip details", "trip");
    });
    return this.load(tripId, user.id);
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

  @UseGuards(TripAccessGuard)
  @RequiresTripRole("viewer")
  @Post(":tripId/members")
  async invite(@Param("tripId") tripId: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canInviteMembers(actor));
    const { email } = parse(inviteBody, body);
    const inviteeId = await this.writer.run(tripId, user.id, async ({ tx, log, tripName }) => {
      const invitee = await findOrCreateUser(tx, email);
      const existing = await tx.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: invitee.id } } });
      if (existing && existing.status !== "removed") throw new ConflictException({ message: "This person is already on the trip" });
      await tx.tripMember.upsert({
        where: { tripId_userId: { tripId, userId: invitee.id } },
        update: { status: "invited", role: "member" },
        create: { tripId, userId: invitee.id, role: "member", status: "invited" },
      });
      await tx.notification.create({ data: inviteNotification(invitee.id, tripId, user.name, tripName) });
      await log(`invited ${invitee.name}`, "member");
      return invitee.id;
    });
    this.realtime.notificationsChanged([inviteeId]);
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
      await tx.tripMember.update({ where: { tripId_userId: { tripId, userId } }, data: { status: "removed" } });
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
      members: trip.members.map((m) => ({ id: m.user.id, name: m.user.name, avatar: m.user.avatar })),
    };
  }

  @HttpCode(200)
  @Post(":code/accept")
  async accept(@Param("code") code: string, @CurrentUser() user: User) {
    const trip = await this.prisma.trip.findUnique({ where: { joinCode: code }, select: { id: true } });
    if (!trip) throw new NotFoundException({ message: "This invite link isn't available" });
    const existing = await this.prisma.tripMember.findUnique({ where: { tripId_userId: { tripId: trip.id, userId: user.id } } });
    if (existing?.status === "removed") throw new ForbiddenException({ message: "You were removed from this trip. Ask an admin to invite you again." });
    if (existing?.status !== "active") {
      await this.writer.run(trip.id, user.id, async ({ tx, log }) => {
        await tx.tripMember.upsert({
          where: { tripId_userId: { tripId: trip.id, userId: user.id } },
          update: { status: "active" },
          create: { tripId: trip.id, userId: user.id, role: "member", status: "active" },
        });
        await tx.notification.deleteMany({ where: { tripId: trip.id, userId: user.id, kind: "invite" } });
        await log("joined via invite link", "member");
      });
      this.realtime.membershipChanged(user.id, trip.id, true);
    }
    return toTrip(await this.prisma.trip.findUniqueOrThrow({ where: { id: trip.id }, include: tripInclude }), user.id);
  }
}
