import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { AccountService } from "../auth/account.service.js";
import { AuthService, normalizeEmail } from "../auth/auth.service.js";
import { AllowUnconfirmed, CurrentUser, SESSION_COOKIE } from "../auth/session.guard.js";
import { imageRef, parse } from "../common/validation.js";
import type { User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { assertRoom, tellHostsIfFull } from "./participants.js";
import { tripInclude, toPerson, toTrip } from "./trip.serializer.js";
import { TripWriter } from "./trip-writer.service.js";

const profileBody = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.email().optional(),
  avatar: imageRef.optional(),
  bio: z.string().max(200).optional(),
  currency: z.string().length(3).optional(),
  travelStyles: z.array(z.string().max(40)).max(20).optional(),
  notify: z.record(z.string(), z.boolean()).optional(),
  privacy: z.object({ profilePublic: z.boolean(), showEmail: z.boolean(), shareLocation: z.boolean() }).optional(),
  onboarded: z.boolean().optional(),
  seenReleaseNotes: z.string().max(40).optional(),
});
const savedBody = z.object({ saved: z.array(z.string().max(40)).max(200) });
const readBody = z.object({ id: z.string().optional() });
const deleteAccountBody = z.object({ password: z.string().max(200).optional(), email: z.string().max(320).optional() });

const toSettings = (u: User) => ({ currency: u.currency, bio: u.bio, travelStyles: u.travelStyles, notify: u.notify, privacy: u.privacy });

const toNotification = (n: { id: string; tripId: string | null; kind: string; title: string; body: string; at: Date; read: boolean; link: string | null }) => ({
  id: n.id,
  tripId: n.tripId ?? undefined,
  kind: n.kind,
  title: n.title,
  body: n.body,
  at: n.at.toISOString(),
  read: n.read,
  link: n.link ?? undefined,
});

/** An email invite goes to whoever owns that address, which only a verified account has shown. */
export function assertVerified(user: User, action: string) {
  if (!user.emailVerifiedAt) throw new ForbiddenException({ code: "EMAIL_NOT_VERIFIED", message: `Verify your email before you ${action}. Check your inbox for the link.` });
}

/** The UI's AppState, plus the per-user actions that aren't scoped to a single trip. */
@Controller()
export class StateController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: TripWriter,
    private readonly realtime: RealtimeGateway,
    private readonly auth: AuthService,
    private readonly account: AccountService,
  ) {}

  @AllowUnconfirmed()
  @Get("state")
  async state(@CurrentUser() user: User) {
    const [trips, notifications] = await Promise.all([this.tripsFor(user.id), this.notificationsFor(user)]);
    return { version: 1, authed: true, onboarded: user.onboarded, emailVerified: !!user.emailVerifiedAt, mustConfirmEmail: user.mustConfirmEmail && !user.emailVerifiedAt, hasPassword: !!user.passwordHash, termsAccepted: !!user.termsAcceptedAt, emailEnabled: this.auth.emailEnabled, seenReleaseNotes: user.seenReleaseNotes, user: toPerson(user), settings: toSettings(user), saved: user.savedDestinations, trips, notifications };
  }

  @Get("notifications")
  notifications(@CurrentUser() user: User) {
    return this.notificationsFor(user);
  }

  @AllowUnconfirmed()
  @Patch("me")
  async updateMe(@CurrentUser() user: User, @Body() body: unknown) {
    const patch = parse(profileBody, body);
    const email = patch.email ? normalizeEmail(patch.email) : undefined;
    if (email && email !== user.email && (await this.prisma.user.findUnique({ where: { email } }))) throw new ConflictException({ message: "That email is already in use" });
    const emailChanged = !!email && email !== user.email;
    if (emailChanged) await this.auth.assertCanChangeEmailTo(user.id, email);
    // A new address is unproven until its owner clicks the link, so anything sent to it stays hidden until then.
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { ...patch, email, ...(emailChanged ? { emailVerifiedAt: null } : {}) } });
    if (emailChanged) await this.auth.sendVerificationToNewAddress(updated);
    // Every trip this person belongs to shows their name and avatar.
    const memberships = await this.prisma.tripMember.findMany({ where: { userId: user.id, status: "active" }, select: { tripId: true } });
    if (patch.name || patch.avatar !== undefined || email) memberships.forEach((m) => this.realtime.tripChanged(m.tripId));
    // Turning this off has to take effect right away, not when a current share runs out.
    if (patch.privacy?.shareLocation === false) {
      const shares = await this.prisma.liveLocation.findMany({ where: { userId: user.id }, select: { tripId: true } });
      await this.prisma.liveLocation.deleteMany({ where: { userId: user.id } });
      shares.forEach((s) => this.realtime.locationsChanged(s.tripId));
    }
    return { user: toPerson(updated), settings: toSettings(updated), onboarded: updated.onboarded, emailVerified: !!updated.emailVerifiedAt };
  }

  /** Older accounts confirm once that they're 18 or over and accept the terms. */
  @AllowUnconfirmed()
  @HttpCode(200)
  @Post("me/accept-terms")
  async acceptTerms(@CurrentUser() user: User) {
    await this.prisma.user.update({ where: { id: user.id }, data: { termsAcceptedAt: user.termsAcceptedAt ?? new Date() } });
    return { ok: true };
  }

  @AllowUnconfirmed()
  @HttpCode(200)
  @Post("me/delete")
  async deleteAccount(@CurrentUser() user: User, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    await this.account.deleteAccount(user, parse(deleteAccountBody, body ?? {}));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }

  @Put("me/saved")
  async setSaved(@CurrentUser() user: User, @Body() body: unknown) {
    const { saved } = parse(savedBody, body);
    await this.prisma.user.update({ where: { id: user.id }, data: { savedDestinations: saved } });
    return { saved };
  }

  @HttpCode(200)
  @Post("notifications/read")
  async markRead(@CurrentUser() user: User, @Body() body: unknown) {
    const { id } = parse(readBody, body ?? {});
    await this.prisma.notification.updateMany({ where: { userId: user.id, ...(id ? { id } : {}) }, data: { read: true } });
    return { ok: true };
  }

  /** Dismissing an invite declines it: the invited member row is removed from the trip. */
  @Delete("notifications/:id")
  async dismiss(@CurrentUser() user: User, @Param("id") id: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId: user.id } });
    if (!n) return { ok: true };
    if (n.kind === "invite") assertVerified(user, "respond to an invitation");
    await this.prisma.notification.delete({ where: { id } });
    if (n.kind === "invite" && n.tripId) {
      const { count } = await this.prisma.tripMember.updateMany({ where: { tripId: n.tripId, userId: user.id, status: "invited" }, data: { status: "removed" } });
      if (count) this.realtime.tripChanged(n.tripId);
    }
    return { ok: true };
  }

  @HttpCode(200)
  @Post("notifications/:id/accept")
  async acceptInvite(@CurrentUser() user: User, @Param("id") id: string) {
    assertVerified(user, "accept an invitation");
    const n = await this.prisma.notification.findFirst({ where: { id, userId: user.id, kind: "invite" } });
    if (!n?.tripId) throw new NotFoundException({ message: "This invitation is no longer available" });
    const tripId = n.tripId;
    await this.writer.run(tripId, user.id, async (ctx) => {
      const { tx, log } = ctx;
      // A full trip leaves the invitation where it is, so it still works if a place opens up.
      await assertRoom(tx, tripId, user.id);
      const { count } = await tx.tripMember.updateMany({ where: { tripId, userId: user.id, status: "invited" }, data: { status: "active" } });
      if (!count) throw new NotFoundException({ message: "This invitation is no longer available" });
      await tx.notification.delete({ where: { id } });
      await log("joined the trip", "member");
      await tellHostsIfFull(ctx, tripId);
    });
    this.realtime.membershipChanged(user.id, tripId, true);
    return this.tripFor(tripId, user.id);
  }

  private async tripsFor(userId: string) {
    const rows = await this.prisma.trip.findMany({ where: { members: { some: { userId, status: "active" } } }, include: tripInclude, orderBy: { startDate: "asc" } });
    return rows.map((t) => toTrip(t, userId));
  }

  private async tripFor(tripId: string, userId: string) {
    return toTrip(await this.prisma.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripInclude }), userId);
  }

  private async notificationsFor(user: User) {
    // Email invites name the trip, so they aren't shown to an account that hasn't proved it owns the address.
    const rows = await this.prisma.notification.findMany({ where: { userId: user.id, ...(user.emailVerifiedAt ? {} : { kind: { not: "invite" } }) }, orderBy: { at: "desc" }, take: 100 });
    return rows.map(toNotification);
  }
}
