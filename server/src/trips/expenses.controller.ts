import { Body, ConflictException, Controller, Delete, Get, Param, Put, UnprocessableEntityException, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/session.guard.js";
import { Actor, enforce, RequiresTripRole, TripAccessGuard } from "../authz/trip-access.guard.js";
import { canContribute, canManageOwnContent } from "../authz/trip-policies.js";
import type { TripActor } from "../authz/trip-roles.js";
import { expenseDeltas, fromMinor, type LedgerDelta, settlementDeltas, sharesMatchTotal, toMinor } from "../common/money.js";
import { asDate, clientId, isoDate, longText, money, parse, shortText, version } from "../common/validation.js";
import type { Prisma, User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { TripWriter, updateVersioned } from "./trip-writer.service.js";

const expenseBody = z.object({
  title: shortText.min(2),
  amount: money.positive(),
  category: z.enum(["stay", "food", "transport", "activities", "shopping", "other"]),
  paidBy: z.string(),
  date: isoDate,
  splitType: z.enum(["equal", "custom"]),
  shares: z.array(z.object({ memberId: z.string(), amount: money })).min(1).max(50),
  notes: longText.default(""),
  version,
});

const settlementBody = z.object({ from: z.string(), to: z.string(), amount: money.positive(), date: isoDate }).refine((s) => s.from !== s.to, { message: "A payment needs two different people" });

const fmt = (minor: number, currency: string) => new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(fromMinor(minor));

/** Removed members still count: they can appear on past expenses. */
async function assertOnTrip(tx: Prisma.TransactionClient, tripId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const found = await tx.tripMember.count({ where: { tripId, userId: { in: unique } } });
  if (found !== unique.length) throw new UnprocessableEntityException({ message: "Everyone on an expense must be on this trip" });
}

async function writeLedger(tx: Prisma.TransactionClient, tripId: string, sourceType: string, sourceId: string, deltas: LedgerDelta[]) {
  await tx.ledgerEntry.createMany({ data: deltas.map((d) => ({ tripId, sourceType, sourceId, ...d })) });
}

/** Cancels whatever a source currently contributes, leaving the history in place. */
async function reverseLedger(tx: Prisma.TransactionClient, tripId: string, sourceType: string, sourceId: string) {
  const net = await tx.ledgerEntry.groupBy({ by: ["memberId"], where: { tripId, sourceType, sourceId }, _sum: { amountMinor: true } });
  const reversal = net.filter((n) => n._sum.amountMinor).map((n) => ({ memberId: n.memberId, amountMinor: -(n._sum.amountMinor as number) }));
  if (reversal.length) await writeLedger(tx, tripId, sourceType, sourceId, reversal);
}

@UseGuards(TripAccessGuard)
@RequiresTripRole("viewer")
@Controller("trips/:tripId")
export class ExpensesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: TripWriter,
  ) {}

  @Put("expenses/:id")
  async upsert(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    parse(clientId, id);
    const input = parse(expenseBody, body);
    const amountMinor = toMinor(input.amount);
    const shares = input.shares.filter((s) => s.amount > 0).map((s) => ({ memberId: s.memberId, amountMinor: toMinor(s.amount) }));
    if (!sharesMatchTotal(amountMinor, shares.map((s) => s.amountMinor))) throw new UnprocessableEntityException({ message: "Split amounts must add up exactly to the total" });

    const existing = await this.prisma.expense.findUnique({ where: { id } });
    if (existing && existing.tripId !== tripId) throw new ConflictException({ message: "Please try again" });
    if (existing) enforce(canManageOwnContent(actor, existing.createdById, "expense"));
    else enforce(canContribute(actor));

    await this.writer.run(tripId, user.id, async ({ tx, log, notify, tripName }) => {
      await assertOnTrip(tx, tripId, [input.paidBy, ...shares.map((s) => s.memberId)]);
      const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId }, select: { currency: true } });
      const data = { title: input.title, amountMinor, category: input.category, paidBy: input.paidBy, date: asDate(input.date), splitType: input.splitType, notes: input.notes };
      const label = `“${input.title}” (${fmt(amountMinor, trip.currency)})`;
      if (existing) {
        await updateVersioned(tx.expense as never, { id, tripId }, input.version, data);
        await tx.expenseShare.deleteMany({ where: { expenseId: id } });
        await tx.expenseShare.createMany({ data: shares.map((s) => ({ ...s, expenseId: id })) });
        await reverseLedger(tx, tripId, "expense", id);
        await log(`edited an expense ${label}`, "expense");
      } else {
        await tx.expense.create({ data: { ...data, id, tripId, createdById: user.id, shares: { create: shares } } });
        await log(`added an expense ${label}`, "expense");
        await notify({ kind: "expense", title: `New expense in ${tripName}`, body: `${input.title} · ${fmt(amountMinor, trip.currency)}`, link: `/app/trips/${tripId}/expenses`, to: shares.map((s) => s.memberId) });
      }
      await writeLedger(tx, tripId, "expense", id, expenseDeltas(input.paidBy, amountMinor, shares));
    });
    return { ok: true };
  }

  @Delete("expenses/:id")
  async remove(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User) {
    const expense = await this.prisma.expense.findFirst({ where: { id, tripId } });
    if (!expense) return { ok: true };
    enforce(canManageOwnContent(actor, expense.createdById, "expense"));
    await this.writer.run(tripId, user.id, async ({ tx, log }) => {
      await reverseLedger(tx, tripId, "expense", id);
      await tx.expense.delete({ where: { id } });
      await log(`deleted the expense “${expense.title}”`, "expense");
    });
    return { ok: true };
  }

  @Put("settlements/:id")
  async settle(@Param("tripId") tripId: string, @Param("id") id: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canContribute(actor));
    parse(clientId, id);
    const input = parse(settlementBody, body);
    const amountMinor = toMinor(input.amount);
    const existing = await this.prisma.settlement.findUnique({ where: { id } });
    if (existing) {
      if (existing.tripId !== tripId) throw new ConflictException({ message: "Please try again" });
      return { ok: true };
    }
    await this.writer.run(tripId, user.id, async ({ tx, log }) => {
      await assertOnTrip(tx, tripId, [input.from, input.to]);
      const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId }, select: { currency: true } });
      await tx.settlement.create({ data: { id, tripId, from: input.from, to: input.to, amountMinor, date: asDate(input.date), createdById: user.id } });
      await writeLedger(tx, tripId, "settlement", id, settlementDeltas(input.from, input.to, amountMinor));
      await log(`recorded a settlement of ${fmt(amountMinor, trip.currency)}`, "expense");
    });
    return { ok: true };
  }

  /** The audited figure. It must always agree with what the UI derives from expenses and settlements. */
  @Get("balances")
  async balances(@Param("tripId") tripId: string) {
    const rows = await this.prisma.ledgerEntry.groupBy({ by: ["memberId"], where: { tripId }, _sum: { amountMinor: true } });
    return Object.fromEntries(rows.map((r) => [r.memberId, fromMinor(r._sum.amountMinor ?? 0)]));
  }
}
