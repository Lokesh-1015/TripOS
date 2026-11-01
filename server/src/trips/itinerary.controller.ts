import { Body, ConflictException, Controller, Delete, HttpCode, NotFoundException, Param, Post, Put, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/session.guard.js";
import { Actor, enforce, RequiresTripRole, TripAccessGuard } from "../authz/trip-access.guard.js";
import { canContribute } from "../authz/trip-policies.js";
import type { TripActor } from "../authz/trip-roles.js";
import { toMinor } from "../common/money.js";
import { clientId, hhmm, longText, money, parse, shortText, version } from "../common/validation.js";
import type { User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { TripWriter, updateVersioned } from "./trip-writer.service.js";

const activityBody = z
  .object({
    day: z.number().int().min(0).max(366),
    title: shortText.min(2),
    start: hhmm,
    end: hhmm,
    location: shortText.default(""),
    description: longText.default(""),
    cost: money.default(0),
    notes: longText.default(""),
    assignees: z.array(z.string()).max(50).default([]),
    version,
  })
  .refine((a) => a.end > a.start, { message: "End time must be after start time", path: ["end"] });

const reorderBody = z.object({ day: z.number().int().min(0), ids: z.array(z.string()).max(500) });
const commentBody = z.object({ id: clientId, text: z.string().trim().min(1).max(2000) });
const attachmentBody = z.object({ name: z.string().trim().min(1).max(255) });

@UseGuards(TripAccessGuard)
@RequiresTripRole("member")
@Controller("trips/:tripId/activities")
export class ItineraryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: TripWriter,
  ) {}

  @Put(":id")
  async upsert(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canContribute(actor));
    parse(clientId, id);
    const { version: expected, cost, ...input } = parse(activityBody, body);
    const data = { ...input, costMinor: toMinor(cost) };
    const existing = await this.prisma.activity.findUnique({ where: { id } });
    if (existing && existing.tripId !== tripId) throw new ConflictException({ message: "Please try again" });
    await this.writer.run(tripId, user.id, async ({ tx, log, notify, tripName }) => {
      if (existing) {
        await updateVersioned(tx.activity as never, { id, tripId }, expected, data);
      } else {
        const last = await tx.activity.aggregate({ where: { tripId, day: input.day }, _max: { position: true } });
        await tx.activity.create({ data: { ...data, id, tripId, position: (last._max.position ?? -1) + 1, attachments: [] } });
        await notify({ kind: "itinerary", title: `Itinerary updated in ${tripName}`, body: `${input.title} added on day ${input.day + 1}`, link: `/app/trips/${tripId}/itinerary` });
      }
      await log(`${existing ? "updated" : "added"} “${input.title}” on day ${input.day + 1}`, "itinerary");
    });
    return { ok: true };
  }

  /** Only the listed items move; anything added meanwhile by someone else keeps its place at the end. */
  @HttpCode(200)
  @Post("reorder")
  async reorder(@Param("tripId") tripId: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canContribute(actor));
    const { day, ids } = parse(reorderBody, body);
    await this.writer.run(tripId, user.id, async ({ tx }) => {
      await Promise.all(ids.map((id, position) => tx.activity.updateMany({ where: { id, tripId, day }, data: { position } })));
    });
    return { ok: true };
  }

  @Post(":id/comments")
  async comment(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canContribute(actor));
    const input = parse(commentBody, body);
    const activity = await this.prisma.activity.findFirst({ where: { id, tripId } });
    if (!activity) throw new NotFoundException({ message: "This activity no longer exists" });
    await this.writer.run(tripId, user.id, async ({ tx, log }) => {
      await tx.activityComment.upsert({ where: { id: input.id }, update: {}, create: { id: input.id, activityId: id, authorId: user.id, text: input.text } });
      await log(`commented on “${activity.title}”`, "itinerary");
    });
    return { ok: true };
  }

  @Post(":id/attachments")
  async attach(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canContribute(actor));
    const { name } = parse(attachmentBody, body);
    await this.writer.run(tripId, user.id, async ({ tx }) => {
      const { count } = await tx.activity.updateMany({ where: { id, tripId }, data: { attachments: { push: name } } });
      if (!count) throw new NotFoundException({ message: "This activity no longer exists" });
    });
    return { ok: true };
  }

  @Delete(":id")
  async remove(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User) {
    enforce(canContribute(actor));
    const activity = await this.prisma.activity.findFirst({ where: { id, tripId } });
    if (!activity) return { ok: true };
    await this.writer.run(tripId, user.id, async ({ tx, log }) => {
      await tx.activity.delete({ where: { id } });
      await log(`removed “${activity.title}” from the itinerary`, "itinerary");
    });
    return { ok: true };
  }
}
