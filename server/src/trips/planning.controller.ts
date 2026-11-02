import { Body, ConflictException, Controller, Delete, Param, Put, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/session.guard.js";
import { Actor, enforce, RequiresTripRole, TripAccessGuard } from "../authz/trip-access.guard.js";
import { canContribute } from "../authz/trip-policies.js";
import type { TripActor } from "../authz/trip-roles.js";
import { asDate, clientId, isoDate, longText, parse, shortText, version } from "../common/validation.js";
import type { User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { TripWriter, updateVersioned } from "./trip-writer.service.js";

const taskBody = z.object({
  title: shortText.min(2),
  description: longText.default(""),
  assignee: z.string(),
  due: isoDate,
  priority: z.enum(["low", "medium", "high"]),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  done: z.boolean().default(false),
  version,
});

const packingBody = z.object({
  name: shortText.min(1),
  category: z.enum(["clothing", "toiletries", "electronics", "documents", "medicines", "essentials", "misc"]),
  qty: z.number().int().min(1).max(99),
  scope: z.enum(["personal", "shared"]),
  assignee: z.string(),
  packed: z.boolean().default(false),
  version,
});

const placeBody = z.object({
  name: shortText.min(2),
  type: z.enum(["destination", "stay", "food", "activity", "meetup"]),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  address: shortText.default(""),
  note: shortText.default(""),
  version,
});

@UseGuards(TripAccessGuard)
@RequiresTripRole("viewer")
@Controller("trips/:tripId")
export class PlanningController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: TripWriter,
  ) {}

  @Put("tasks/:id")
  async upsertTask(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canContribute(actor));
    parse(clientId, id);
    const { version: expected, due, status: requested, ...fields } = parse(taskBody, body);
    // `done` drives progress counts in the UI, so the two can never disagree.
    const status = requested ?? (fields.done ? "done" : "todo");
    const input = { ...fields, status, done: status === "done" };
    const data = { ...input, due: asDate(due) };
    const existing = await this.prisma.task.findUnique({ where: { id } });
    if (existing && existing.tripId !== tripId) throw new ConflictException({ message: "Please try again" });
    await this.writer.run(tripId, user.id, async ({ tx, log, notify, tripName }) => {
      const assignee = await tx.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: input.assignee } }, include: { user: { select: { name: true } } } });
      if (!assignee) throw new ConflictException({ message: "That person isn't on this trip" });
      if (existing) {
        await updateVersioned(tx.task as never, { id, tripId }, expected, data);
        if (input.done && !existing.done) await log(`completed “${input.title}”`, "task");
        else if (!input.done && existing.done) await log(`reopened “${input.title}”`, "task");
        else await log(`updated “${input.title}”`, "task");
      } else {
        await tx.task.create({ data: { ...data, id, tripId } });
        await log(`assigned “${input.title}” to ${assignee.user.name.split(" ")[0]}`, "task");
      }
      if (input.assignee !== existing?.assignee) {
        await notify({ kind: "task", title: "A task was assigned to you", body: `${input.title} · ${tripName}`, link: `/app/trips/${tripId}/tasks`, to: [input.assignee] });
      }
    });
    return { ok: true };
  }

  @Delete("tasks/:id")
  async removeTask(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User) {
    enforce(canContribute(actor));
    await this.writer.run(tripId, user.id, async ({ tx }) => {
      await tx.task.deleteMany({ where: { id, tripId } });
    });
    return { ok: true };
  }

  @Put("packing/:id")
  async upsertPacking(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canContribute(actor));
    parse(clientId, id);
    const { version: expected, ...input } = parse(packingBody, body);
    const existing = await this.prisma.packingItem.findUnique({ where: { id } });
    if (existing && existing.tripId !== tripId) throw new ConflictException({ message: "Please try again" });
    // A personal list belongs to one person: nobody else can read or change it.
    if (existing?.scope === "personal" && existing.assignee !== user.id) throw new ConflictException({ message: "Please try again" });
    const data = input.scope === "personal" ? { ...input, assignee: user.id } : input;
    await this.writer.run(tripId, user.id, async ({ tx }) => {
      if (existing) await updateVersioned(tx.packingItem as never, { id, tripId }, expected, data);
      else await tx.packingItem.create({ data: { ...data, id, tripId } });
    });
    return { ok: true };
  }

  @Delete("packing/:id")
  async removePacking(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User) {
    enforce(canContribute(actor));
    await this.writer.run(tripId, user.id, async ({ tx }) => {
      await tx.packingItem.deleteMany({ where: { id, tripId, OR: [{ scope: "shared" }, { assignee: user.id }] } });
    });
    return { ok: true };
  }

  @Put("places/:id")
  async upsertPlace(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canContribute(actor));
    parse(clientId, id);
    const { version: expected, ...input } = parse(placeBody, body);
    const existing = await this.prisma.place.findUnique({ where: { id } });
    if (existing && existing.tripId !== tripId) throw new ConflictException({ message: "Please try again" });
    await this.writer.run(tripId, user.id, async ({ tx, log }) => {
      if (existing) await updateVersioned(tx.place as never, { id, tripId }, expected, input);
      else {
        await tx.place.create({ data: { ...input, id, tripId } });
        await log(`saved “${input.name}” to the map`, "map");
      }
    });
    return { ok: true };
  }

  @Delete("places/:id")
  async removePlace(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User) {
    enforce(canContribute(actor));
    await this.writer.run(tripId, user.id, async ({ tx }) => {
      await tx.place.deleteMany({ where: { id, tripId } });
    });
    return { ok: true };
  }
}
