import { randomUUID } from "node:crypto";
import { Body, ConflictException, Controller, Delete, Get, HttpCode, Param, Post, Put, UnprocessableEntityException, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/session.guard.js";
import { Actor, enforce, RequiresTripRole, TripAccessGuard } from "../authz/trip-access.guard.js";
import { canContribute, canEditTrip, canManageOwnContent } from "../authz/trip-policies.js";
import type { TripActor } from "../authz/trip-roles.js";
import { allocate, convertedBalances, correctionTransfers, expenseDeltas, fromMinor, type LedgerDelta, settlementDeltas, sharesMatchTotal, toMinor } from "../common/money.js";
import { asDate, clientId, isoDate, longText, money, parse, shortText, version } from "../common/validation.js";
import type { Prisma, User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { TripWriter, updateVersioned } from "./trip-writer.service.js";

const expenseBody = z.object({
  title: shortText.min(2),
  amount: money.positive(),
  original: z.object({ amount: money.positive(), currency: z.string().length(3), rate: z.number().positive().max(1_000_000) }).optional(),
  category: z.enum(["stay", "food", "transport", "activities", "shopping", "other"]),
  paidBy: z.string(),
  date: isoDate,
  splitType: z.enum(["equal", "custom"]),
  shares: z.array(z.object({ memberId: z.string(), amount: money })).min(1).max(50),
  notes: longText.default(""),
  version,
});

const settlementBody = z.object({ from: z.string(), to: z.string(), amount: money.positive(), date: isoDate }).refine((s) => s.from !== s.to, { message: "A payment needs two different people" });

const convertBody = z.object({ currency: z.string().length(3), rate: z.number().positive().max(1_000_000) });

const fmt = (minor: number, currency: string) => new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(fromMinor(minor));

/** Balance-changing writes take turns per trip, so a conversion can't interleave with a new expense. */
async function lockTrip(tx: Prisma.TransactionClient, tripId: string) {
  await tx.$queryRaw`SELECT id FROM trips WHERE id = ${tripId} FOR UPDATE`;
}

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
    if (input.original && Math.abs(toMinor(input.original.amount * input.original.rate) - amountMinor) > 1) throw new UnprocessableEntityException({ message: "The converted amount doesn't match the exchange rate" });

    const existing = await this.prisma.expense.findUnique({ where: { id } });
    if (existing && existing.tripId !== tripId) throw new ConflictException({ message: "Please try again" });
    if (existing) enforce(canManageOwnContent(actor, existing.createdById, "expense"));
    else enforce(canContribute(actor));

    await this.writer.run(tripId, user.id, async ({ tx, log, notify, tripName }) => {
      await lockTrip(tx, tripId);
      await assertOnTrip(tx, tripId, [input.paidBy, ...shares.map((s) => s.memberId)]);
      const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId }, select: { currency: true } });
      const original = input.original && input.original.currency !== trip.currency ? input.original : null;
      const data = { originalAmountMinor: original ? toMinor(original.amount) : null, originalCurrency: original?.currency ?? null, fxRate: original?.rate ?? null, title: input.title, amountMinor, category: input.category, paidBy: input.paidBy, date: asDate(input.date), splitType: input.splitType, notes: input.notes };
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
      await lockTrip(tx, tripId);
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
      await lockTrip(tx, tripId);
      await assertOnTrip(tx, tripId, [input.from, input.to]);
      const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId }, select: { currency: true } });
      await tx.settlement.create({ data: { id, tripId, from: input.from, to: input.to, amountMinor, date: asDate(input.date), createdById: user.id } });
      await writeLedger(tx, tripId, "settlement", id, settlementDeltas(input.from, input.to, amountMinor));
      await log(`recorded a settlement of ${fmt(amountMinor, trip.currency)}`, "expense");
    });
    return { ok: true };
  }

  /**
   * Moves the whole trip to another currency at a rate the group agrees. Everything is converted in one
   * transaction, split shares still add up exactly, and rounding is corrected so balances stay fair:
   * people who were settled stay settled.
   */
  @HttpCode(200)
  @Post("convert-currency")
  async convert(@Param("tripId") tripId: string, @Actor() actor: TripActor, @CurrentUser() user: User, @Body() body: unknown) {
    enforce(canEditTrip(actor));
    const { currency, rate } = parse(convertBody, body);
    const round = (minor: number) => Math.round(minor * rate);
    await this.writer.run(
      tripId,
      user.id,
      async ({ tx, log, notify, tripName }) => {
        await lockTrip(tx, tripId);
        const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
        if (trip.currency === currency) throw new ConflictException({ message: `This trip is already in ${currency}` });
        const before = await tx.ledgerEntry.groupBy({ by: ["memberId"], where: { tripId }, _sum: { amountMinor: true } });
        const target = convertedBalances(Object.fromEntries(before.map((b) => [b.memberId, b._sum.amountMinor ?? 0])), rate);

        const actual: Record<string, number> = {};
        const apply = (deltas: LedgerDelta[]) => deltas.forEach((d) => (actual[d.memberId] = (actual[d.memberId] ?? 0) + d.amountMinor));

        const expenses = await tx.expense.findMany({ where: { tripId }, include: { shares: true } });
        for (const e of expenses) {
          const amountMinor = round(e.amountMinor);
          const parts = allocate(amountMinor, e.shares.map((s) => s.amountMinor));
          const shares = e.shares.map((s, i) => ({ memberId: s.memberId, amountMinor: parts[i] })).filter((s) => s.amountMinor > 0);
          await tx.expense.update({ where: { id: e.id }, data: { amountMinor, fxRate: e.fxRate ? e.fxRate * rate : undefined, version: { increment: 1 } } });
          await tx.expenseShare.deleteMany({ where: { expenseId: e.id } });
          await tx.expenseShare.createMany({ data: shares.map((s) => ({ ...s, expenseId: e.id })) });
          await reverseLedger(tx, tripId, "expense", e.id);
          const deltas = expenseDeltas(e.paidBy, amountMinor, shares);
          await writeLedger(tx, tripId, "expense", e.id, deltas);
          apply(deltas);
        }

        const settlements = await tx.settlement.findMany({ where: { tripId } });
        for (const s of settlements) {
          const amountMinor = round(s.amountMinor);
          await reverseLedger(tx, tripId, "settlement", s.id);
          if (amountMinor === 0) {
            await tx.settlement.delete({ where: { id: s.id } });
            continue;
          }
          await tx.settlement.update({ where: { id: s.id }, data: { amountMinor } });
          const deltas = settlementDeltas(s.from, s.to, amountMinor);
          await writeLedger(tx, tripId, "settlement", s.id, deltas);
          apply(deltas);
        }

        // Rounding each row can leave someone a paisa off. These corrections restore the exact balances.
        for (const fix of correctionTransfers(actual, target)) {
          const id = `adj-${randomUUID()}`;
          await tx.settlement.create({ data: { id, tripId, from: fix.from, to: fix.to, amountMinor: fix.amountMinor, isAdjustment: true, date: new Date(), createdById: user.id } });
          await writeLedger(tx, tripId, "settlement", id, settlementDeltas(fix.from, fix.to, fix.amountMinor));
        }

        const activities = await tx.activity.findMany({ where: { tripId, costMinor: { gt: 0 } }, select: { id: true, costMinor: true } });
        for (const a of activities) await tx.activity.update({ where: { id: a.id }, data: { costMinor: round(a.costMinor), version: { increment: 1 } } });
        const options = await tx.pollOption.findMany({ where: { poll: { tripId }, costMinor: { gt: 0 } }, select: { id: true, costMinor: true } });
        for (const o of options) await tx.pollOption.update({ where: { id: o.id }, data: { costMinor: round(o.costMinor as number) } });

        await tx.trip.update({ where: { id: tripId }, data: { currency, budgetMinor: round(trip.budgetMinor), perPersonBudgetMinor: round(trip.perPersonBudgetMinor), version: { increment: 1 } } });
        await log(`converted the trip from ${trip.currency} to ${currency} (1 ${trip.currency} = ${rate} ${currency})`, "trip");
        await notify({ kind: "expense", title: `${tripName} is now in ${currency}`, body: `Converted from ${trip.currency} at 1 ${trip.currency} = ${rate} ${currency}`, link: `/app/trips/${tripId}/expenses` });
      },
      { timeout: 30_000 },
    );
    return { ok: true };
  }

  /** The audited figure. It must always agree with what the UI derives from expenses and settlements. */
  @Get("balances")
  async balances(@Param("tripId") tripId: string) {
    const rows = await this.prisma.ledgerEntry.groupBy({ by: ["memberId"], where: { tripId }, _sum: { amountMinor: true } });
    return Object.fromEntries(rows.map((r) => [r.memberId, fromMinor(r._sum.amountMinor ?? 0)]));
  }
}
