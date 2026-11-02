import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Put, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { z } from "zod";
import { CurrentUser } from "../auth/session.guard.js";
import { RequiresTripRole, TripAccessGuard } from "../authz/trip-access.guard.js";
import { parse } from "../common/validation.js";
import type { User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { TripWriter } from "./trip-writer.service.js";

const position = {
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).nullable().optional(),
};
const startBody = z.object({ ...position, hours: z.union([z.literal(1), z.literal(4), z.literal(8)]) });
const updateBody = z.object(position);

const HOUR_MS = 60 * 60 * 1000;

/**
 * Live location is privacy-first. Sharing is chosen per trip and always ends by itself. Only the latest
 * position exists, with no history, and it's deleted when sharing ends. Positions never travel over a
 * socket: members are told something changed, then fetch it through the membership check below.
 */
@UseGuards(ThrottlerGuard)
@Throttle({ default: { ttl: 60_000, limit: 120 } })
@Controller()
export class LiveLocationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly writer: TripWriter,
  ) {}

  /** There's no background job, because one would keep the free database awake. Expired positions go on the next request. */
  private deleteExpired() {
    return this.prisma.liveLocation.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  }

  @Get("live-locations/mine")
  async mine(@CurrentUser() user: User) {
    await this.deleteExpired();
    const shares = await this.prisma.liveLocation.findMany({ where: { userId: user.id }, select: { tripId: true, expiresAt: true } });
    return shares.map((s) => ({ tripId: s.tripId, expiresAt: s.expiresAt.toISOString() }));
  }

  /** Signing out on this device stops sharing everywhere, so no last position is left showing. */
  @HttpCode(200)
  @Delete("live-locations/mine")
  async stopAll(@CurrentUser() user: User) {
    const shares = await this.prisma.liveLocation.findMany({ where: { userId: user.id }, select: { tripId: true } });
    await this.prisma.liveLocation.deleteMany({ where: { userId: user.id } });
    shares.forEach((s) => this.realtime.locationsChanged(s.tripId));
    return { ok: true };
  }

  @UseGuards(TripAccessGuard)
  @RequiresTripRole("viewer")
  @Get("trips/:tripId/live-locations")
  async list(@Param("tripId") tripId: string) {
    await this.deleteExpired();
    const members = await this.prisma.tripMember.findMany({ where: { tripId, status: "active" }, select: { userId: true } });
    const active = members.map((m) => m.userId);
    // Someone who has left the trip stops being visible straight away.
    await this.prisma.liveLocation.deleteMany({ where: { tripId, userId: { notIn: active } } });
    const rows = await this.prisma.liveLocation.findMany({ where: { tripId } });
    return rows.map((r) => ({ userId: r.userId, lat: r.lat, lng: r.lng, accuracy: r.accuracy, updatedAt: r.updatedAt.toISOString(), expiresAt: r.expiresAt.toISOString() }));
  }

  @UseGuards(TripAccessGuard)
  @RequiresTripRole("viewer")
  @Put("trips/:tripId/live-locations/me")
  async start(@Param("tripId") tripId: string, @CurrentUser() user: User, @Body() body: unknown) {
    const { hours, lat, lng, accuracy } = parse(startBody, body);
    if ((user.privacy as { shareLocation?: boolean } | null)?.shareLocation === false) {
      throw new ForbiddenException({ message: "Location sharing is turned off in your privacy settings" });
    }
    const expiresAt = new Date(Date.now() + hours * HOUR_MS);
    const data = { lat, lng, accuracy: accuracy ?? null, expiresAt };
    await this.writer.run(tripId, user.id, async ({ tx, log }) => {
      await tx.liveLocation.upsert({ where: { tripId_userId: { tripId, userId: user.id } }, create: { ...data, tripId, userId: user.id }, update: data });
      await log(`started sharing their live location for ${hours} ${hours === 1 ? "hour" : "hours"}`, "map");
    });
    this.realtime.locationsChanged(tripId);
    return { tripId, expiresAt: expiresAt.toISOString() };
  }

  /** Moving a position can't extend it: only choosing to share again sets a new end time. */
  @UseGuards(TripAccessGuard)
  @RequiresTripRole("viewer")
  @Patch("trips/:tripId/live-locations/me")
  async update(@Param("tripId") tripId: string, @CurrentUser() user: User, @Body() body: unknown) {
    const { lat, lng, accuracy } = parse(updateBody, body);
    const { count } = await this.prisma.liveLocation.updateMany({
      where: { tripId, userId: user.id, expiresAt: { gt: new Date() } },
      data: { lat, lng, accuracy: accuracy ?? null },
    });
    if (!count) throw new NotFoundException({ message: "You're no longer sharing your location on this trip" });
    this.realtime.locationsChanged(tripId);
    return { ok: true };
  }

  @UseGuards(TripAccessGuard)
  @RequiresTripRole("viewer")
  @HttpCode(200)
  @Delete("trips/:tripId/live-locations/me")
  async stop(@Param("tripId") tripId: string, @CurrentUser() user: User) {
    const { count } = await this.prisma.liveLocation.deleteMany({ where: { tripId, userId: user.id } });
    if (count) {
      await this.writer.run(tripId, user.id, async ({ log }) => log("stopped sharing their live location", "map"));
      this.realtime.locationsChanged(tripId);
    }
    return { ok: true };
  }
}
