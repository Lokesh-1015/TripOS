import { Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, UnprocessableEntityException, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/session.guard.js";
import { Actor, enforce, RequiresTripRole, TripAccessGuard } from "../authz/trip-access.guard.js";
import { canInviteMembers } from "../authz/trip-policies.js";
import type { TripActor } from "../authz/trip-roles.js";
import { parse } from "../common/validation.js";
import type { Prisma, User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { SocialService } from "../social/social.service.js";
import { TripWriter } from "./trip-writer.service.js";

const leaveBody = z.object({ successorId: z.string().max(64).optional() });
const isAdmin = (role: string) => role === "owner" || role === "admin";
const ONLY_PERSON = "You're the only person on this trip, so there's nobody to hand it over to. You can delete the trip instead, or invite someone, make them an admin, and then leave.";

/**
 * Leaving a trip. Members and viewers ask an admin first. An admin leaves straight away if another admin
 * stays, and the only admin hands over to someone in the same step. Whatever someone added stays, as other
 * people's expenses and chat refer to it: only their access goes.
 */
@UseGuards(TripAccessGuard)
@RequiresTripRole("viewer")
@Controller("trips/:tripId")
export class LeaveController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: TripWriter,
    private readonly realtime: RealtimeGateway,
    private readonly social: SocialService,
  ) {}

  /** What happens if this person leaves, so the screen can explain it before they choose. */
  @Get("leave")
  async options(@Param("tripId") tripId: string, @CurrentUser() user: User) {
    const members = await this.prisma.tripMember.findMany({ where: { tripId, status: "active" }, include: { user: { select: { name: true } } }, orderBy: { joinedAt: "asc" } });
    const me = members.find((m) => m.userId === user.id);
    if (!me) throw new NotFoundException({ message: "You're not on this trip" });
    const others = members.filter((m) => m.userId !== user.id);
    const otherAdmins = others.filter((m) => isAdmin(m.role));
    const pending = await this.prisma.tripLeaveRequest.findFirst({ where: { tripId, userId: user.id, status: "pending" } });
    const mode = !isAdmin(me.role) ? "request" : !others.length ? "only_person" : otherAdmins.length ? "direct" : "choose_successor";
    return {
      mode,
      role: me.role,
      request: pending ? { id: pending.id, at: pending.createdAt.toISOString() } : null,
      // Who'd become owner when the owner leaves and another admin stays.
      nextOwner: me.role === "owner" && otherAdmins.length ? { id: otherAdmins[0].userId, name: otherAdmins[0].user.name } : null,
      candidates: mode === "choose_successor" ? others.map((m) => ({ id: m.userId, name: m.user.name, role: m.role })) : [],
    };
  }

  @HttpCode(200)
  @Post("leave")
  async leave(@Param("tripId") tripId: string, @CurrentUser() user: User, @Body() body: unknown) {
    const { successorId } = parse(leaveBody, body ?? {});
    const result = await this.writer.run(tripId, user.id, async ({ tx, log, notify, tripName }) => {
      // Holds the trip, so two admins leaving at once can't both go and leave it with none.
      await tx.$queryRaw`SELECT "id" FROM "trips" WHERE "id" = ${tripId} FOR UPDATE`;
      const members = await tx.tripMember.findMany({ where: { tripId, status: "active" }, orderBy: { joinedAt: "asc" } });
      const me = members.find((m) => m.userId === user.id);
      if (!me) throw new NotFoundException({ message: "You're not on this trip" });
      const admins = members.filter((m) => isAdmin(m.role) && m.userId !== user.id).map((m) => m.userId);

      if (!isAdmin(me.role)) {
        const pending = await tx.tripLeaveRequest.findFirst({ where: { tripId, userId: user.id, status: "pending" } });
        if (pending) throw new ConflictException({ message: "You've already asked to leave. An admin will decide soon." });
        await tx.tripLeaveRequest.create({ data: { tripId, userId: user.id } });
        await notify({ kind: "leave_request", title: `${user.name} asked to leave ${tripName}`, body: "Approve or decline it in the trip's members list", link: `/app/trips/${tripId}?invite=1`, to: admins, collapseUnread: true });
        return { status: "requested" as const };
      }

      const others = members.filter((m) => m.userId !== user.id);
      if (!others.length) throw new ConflictException({ code: "ONLY_PERSON", message: ONLY_PERSON });
      const otherAdmins = others.filter((m) => isAdmin(m.role));
      let newOwner: string | null = null;
      if (!otherAdmins.length) {
        if (!successorId) throw new ConflictException({ code: "NEEDS_SUCCESSOR", message: "You're the only admin. Choose someone on the trip to take over before you leave." });
        const successor = others.find((m) => m.userId === successorId);
        if (!successor) throw new UnprocessableEntityException({ message: "Choose someone who's on this trip" });
        // The handover and the departure are one change: if either fails, neither happens.
        await tx.tripMember.update({ where: { tripId_userId: { tripId, userId: successorId } }, data: { role: me.role === "owner" ? "owner" : "admin" } });
        if (me.role === "owner") newOwner = successorId;
        const name = (await tx.user.findUniqueOrThrow({ where: { id: successorId }, select: { name: true } })).name;
        await log(`handed the trip over to ${name}`, "member");
      } else if (me.role === "owner") {
        // A trip always has an owner: another admin takes over, the one chosen if they're an admin, else the longest-standing.
        newOwner = otherAdmins.find((m) => m.userId === successorId)?.userId ?? otherAdmins[0].userId;
        await tx.tripMember.update({ where: { tripId_userId: { tripId, userId: newOwner } }, data: { role: "owner" } });
      }
      if (newOwner) await tx.trip.update({ where: { id: tripId }, data: { createdById: newOwner } });
      await this.depart(tx, tripId, user.id);
      await log("left the trip", "member");
      await notify({ kind: "member_left", title: `${user.name} left ${tripName}`, body: newOwner ? "Ownership has passed on, and everything they added stays." : "Everything they added stays.", link: `/app/trips/${tripId}`, to: members.filter((m) => m.userId !== user.id && (isAdmin(m.role) || m.userId === newOwner)).map((m) => m.userId), collapseUnread: true });
      return { status: "left" as const };
    });
    if (result.status === "left") this.realtime.membershipChanged(user.id, tripId, false);
    return result;
  }

  /** Access goes. Their contributions, and their place in the group's records, stay. */
  private async depart(tx: Prisma.TransactionClient, tripId: string, userId: string) {
    await tx.tripMember.update({ where: { tripId_userId: { tripId, userId } }, data: { status: "removed", role: "member", leftAt: new Date() } });
    await tx.liveLocation.deleteMany({ where: { tripId, userId } });
    await tx.notification.deleteMany({ where: { tripId, userId, kind: "invite" } });
  }

  @Delete("leave")
  async cancel(@Param("tripId") tripId: string, @CurrentUser() user: User) {
    const { count } = await this.prisma.tripLeaveRequest.updateMany({ where: { tripId, userId: user.id, status: "pending" }, data: { status: "cancelled", respondedAt: new Date() } });
    if (count) this.realtime.tripChanged(tripId);
    return { ok: true };
  }

  private async pendingRequest(tripId: string, id: string) {
    const request = await this.prisma.tripLeaveRequest.findFirst({ where: { id, tripId, status: "pending" } });
    if (!request) throw new NotFoundException({ message: "That request is no longer waiting" });
    return request;
  }

  @HttpCode(200)
  @Post("leave-requests/:id/approve")
  async approve(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User) {
    enforce(canInviteMembers(actor));
    const request = await this.pendingRequest(tripId, id);
    const tripName = await this.writer.run(tripId, user.id, async ({ tx, log, tripName }) => {
      const member = await tx.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: request.userId } } });
      if (member?.status !== "active") throw new NotFoundException({ message: "That person isn't on this trip any more" });
      await tx.tripLeaveRequest.update({ where: { id }, data: { status: "approved", respondedAt: new Date(), respondedById: user.id } });
      await this.depart(tx, tripId, request.userId);
      const name = (await tx.user.findUniqueOrThrow({ where: { id: request.userId }, select: { name: true } })).name;
      await log(`let ${name} leave the trip`, "member");
      return tripName;
    });
    this.realtime.membershipChanged(request.userId, tripId, false);
    // They're no longer on the trip, so this goes to them directly rather than to the trip's members.
    await this.social.notify(request.userId, { kind: "leave_approved", title: `You've left ${tripName}`, body: "Your request to leave was approved. Everything you added stays with the group.", link: "/app/trips" }, tripId);
    return { ok: true };
  }

  @HttpCode(200)
  @Post("leave-requests/:id/reject")
  async reject(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User) {
    enforce(canInviteMembers(actor));
    const request = await this.pendingRequest(tripId, id);
    await this.writer.run(tripId, user.id, async ({ tx, notify, tripName }) => {
      await tx.tripLeaveRequest.update({ where: { id }, data: { status: "rejected", respondedAt: new Date(), respondedById: user.id } });
      await notify({ kind: "leave_rejected", title: `Your request to leave ${tripName} was declined`, body: "You're still on the trip. Talk to an admin if you need to leave.", link: `/app/trips/${tripId}`, to: [request.userId] });
    });
    return { ok: true };
  }
}
