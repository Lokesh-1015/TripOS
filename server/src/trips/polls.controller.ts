import { Body, ConflictException, Controller, Delete, HttpCode, NotFoundException, Param, Post, Put, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/session.guard.js";
import { Actor, enforce, RequiresTripRole, TripAccessGuard } from "../authz/trip-access.guard.js";
import { canContribute, canManageOwnContent } from "../authz/trip-policies.js";
import type { TripActor } from "../authz/trip-roles.js";
import { toMinor } from "../common/money.js";
import { clientId, money, parse, shortText } from "../common/validation.js";
import type { User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { TripWriter } from "./trip-writer.service.js";

export const pollBody = z.object({
  id: clientId,
  question: shortText.min(3),
  category: z.enum(["destination", "dates", "activity", "restaurant", "hotel"]),
  closed: z.boolean().default(false),
  options: z
    .array(z.object({ id: clientId, label: shortText.min(1), image: z.string().max(500).optional(), description: shortText.optional(), cost: money.optional(), votes: z.array(z.string()).optional() }))
    .min(2)
    .max(20),
});

/** Votes in the body are never trusted; they only change through the vote route. */
export function pollData(p: z.output<typeof pollBody>, tripId: string, createdBy: string) {
  return {
    id: p.id,
    tripId,
    question: p.question,
    category: p.category,
    closed: p.closed,
    createdBy,
    options: {
      create: p.options.map((o, position) => ({ id: o.id, label: o.label, image: o.image, description: o.description, costMinor: o.cost === undefined ? undefined : toMinor(o.cost), position })),
    },
  };
}

// `selected` states the intended result, so a retried request can't undo itself. Without it the vote toggles.
const voteBody = z.object({ optionId: z.string(), selected: z.boolean().optional() });

@UseGuards(TripAccessGuard)
@RequiresTripRole("viewer")
@Controller("trips/:tripId/polls")
export class PollsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: TripWriter,
  ) {}

  @Put(":id")
  async upsert(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    const input = parse(pollBody, { ...(body as object), id });
    const existing = await this.prisma.poll.findUnique({ where: { id } });
    if (existing && existing.tripId !== tripId) throw new ConflictException({ message: "Please try again" });
    if (existing) enforce(canManageOwnContent(actor, existing.createdBy, "poll"));
    else enforce(canContribute(actor));
    await this.writer.run(tripId, user.id, async ({ tx, log, notify, tripName }) => {
      if (!existing) {
        await tx.poll.create({ data: pollData(input, tripId, user.id) });
        await log(`started a poll “${input.question}”`, "vote");
        await notify({ kind: "vote", title: `New poll in ${tripName}`, body: input.question, link: `/app/trips/${tripId}` });
      } else if (existing.closed !== input.closed) {
        await tx.poll.update({ where: { id }, data: { closed: input.closed } });
        await log(`${input.closed ? "closed" : "reopened"} the poll “${existing.question}”`, "vote");
      }
    });
    return { ok: true };
  }

  /**
   * Toggle semantics, matching the UI: choosing your current option removes the vote, choosing
   * another moves it. The primary key on (poll, user) makes one vote per person a database rule.
   */
  @HttpCode(200)
  @Post(":id/vote")
  async vote(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canContribute(actor));
    const { optionId, selected } = parse(voteBody, body);
    await this.writer.run(tripId, user.id, async ({ tx }) => {
      const poll = await tx.poll.findFirst({ where: { id, tripId }, include: { options: { select: { id: true } } } });
      if (!poll) throw new NotFoundException({ message: "This poll no longer exists" });
      if (poll.closed) throw new ConflictException({ message: "This poll is closed" });
      if (!poll.options.some((o) => o.id === optionId)) throw new NotFoundException({ message: "That option no longer exists" });
      const mine = await tx.vote.findUnique({ where: { pollId_userId: { pollId: id, userId: user.id } } });
      if (selected === false ? mine?.optionId === optionId : selected === undefined && mine?.optionId === optionId) {
        await tx.vote.delete({ where: { pollId_userId: { pollId: id, userId: user.id } } });
      } else if (selected !== false) {
        await tx.vote.upsert({
          where: { pollId_userId: { pollId: id, userId: user.id } },
          update: { optionId },
          create: { pollId: id, optionId, userId: user.id },
        });
      }
    });
    return { ok: true };
  }

  @Delete(":id")
  async remove(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User) {
    const poll = await this.prisma.poll.findFirst({ where: { id, tripId } });
    if (!poll) return { ok: true };
    enforce(canManageOwnContent(actor, poll.createdBy, "poll"));
    await this.writer.run(tripId, user.id, async ({ tx }) => {
      await tx.poll.delete({ where: { id } });
    });
    return { ok: true };
  }
}
