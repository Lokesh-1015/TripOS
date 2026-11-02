import { Injectable, Logger } from "@nestjs/common";
import { asDate, dateString } from "../common/validation.js";
import { fromMinor } from "../common/money.js";
import type { NotificationKind } from "../generated/prisma/client.js";
import { MailService } from "../mail/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DIGEST_ITEMS = 5;

/** One thing to tell someone. The key stops the same reminder going out twice, however often the job runs. */
interface Item {
  key: string;
  line: string;
  link: string;
  /** Also shown in the app. A digest only repeats what's already there. */
  inApp?: { tripId: string; kind: NotificationKind; title: string };
}

type Prefs = Record<string, boolean | undefined>;

const addDays = (iso: string, days: number) => dateString(new Date(asDate(iso).getTime() + days * DAY_MS));
const isMonday = (iso: string) => asDate(iso).getUTCDay() === 1;
const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);

/**
 * Runs once a day from a scheduled GitHub workflow, because the free backend sleeps and can't time anything itself.
 * Each person gets at most one email a day, which keeps within Brevo's free 300, and running it twice is harmless.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async runDaily(today = dateString(new Date())) {
    const items = new Map<string, Item[]>();
    const add = (userId: string, item: Item) => items.set(userId, [...(items.get(userId) ?? []), item]);
    await this.tripsStartingSoon(today, add);
    await this.tasksDueSoon(today, add);
    if (isMonday(today)) {
      await this.moneyOwed(today, add);
      await this.weeklyDigest(today, add);
    }
    return this.deliver(items);
  }

  private async tripsStartingSoon(today: string, add: (userId: string, item: Item) => void) {
    const start = addDays(today, 3);
    const trips = await this.prisma.trip.findMany({
      where: { archived: false, startDate: asDate(start) },
      select: { id: true, name: true, members: { where: { status: "active" }, select: { userId: true } } },
    });
    for (const trip of trips) {
      const line = `${trip.name} starts in 3 days.`;
      for (const { userId } of trip.members) {
        add(userId, { key: `trip-start:${trip.id}:${start}`, line, link: `/app/trips/${trip.id}`, inApp: { tripId: trip.id, kind: "itinerary", title: `${trip.name} starts in 3 days` } });
      }
    }
  }

  private async tasksDueSoon(today: string, add: (userId: string, item: Item) => void) {
    const tasks = await this.prisma.task.findMany({
      where: { done: false, due: { gte: asDate(today), lte: asDate(addDays(today, 1)) }, trip: { archived: false } },
      select: { id: true, title: true, due: true, assignee: true, tripId: true, trip: { select: { name: true, members: { where: { status: "active" }, select: { userId: true } } } } },
    });
    for (const task of tasks) {
      if (!task.trip.members.some((m) => m.userId === task.assignee)) continue;
      const due = dateString(task.due);
      const when = due === today ? "today" : "tomorrow";
      add(task.assignee, {
        key: `task:${task.id}:${due}`,
        line: `“${task.title}” on ${task.trip.name} is due ${when}.`,
        link: `/app/trips/${task.tripId}/tasks`,
        inApp: { tripId: task.tripId, kind: "task", title: `A task is due ${when}: ${task.title}` },
      });
    }
  }

  private async moneyOwed(today: string, add: (userId: string, item: Item) => void) {
    const balances = await this.prisma.ledgerEntry.groupBy({ by: ["tripId", "memberId"], _sum: { amountMinor: true } });
    const owing = balances.filter((b) => (b._sum.amountMinor ?? 0) <= -100);
    if (!owing.length) return;
    const trips = await this.prisma.trip.findMany({
      where: { id: { in: [...new Set(owing.map((b) => b.tripId))] }, archived: false },
      select: { id: true, name: true, currency: true, members: { where: { status: "active" }, select: { userId: true } } },
    });
    for (const trip of trips) {
      for (const b of owing.filter((x) => x.tripId === trip.id && trip.members.some((m) => m.userId === x.memberId))) {
        const amount = formatMoney(fromMinor(-(b._sum.amountMinor ?? 0)), trip.currency);
        add(b.memberId, {
          key: `balance:${trip.id}:${today}`,
          line: `You owe ${amount} on ${trip.name}.`,
          link: `/app/trips/${trip.id}/expenses`,
          inApp: { tripId: trip.id, kind: "expense", title: `You owe ${amount} on ${trip.name}` },
        });
      }
    }
  }

  private async weeklyDigest(today: string, add: (userId: string, item: Item) => void) {
    const since = new Date(asDate(today).getTime() - 7 * DAY_MS);
    const unread = await this.prisma.notification.findMany({
      where: { read: false, at: { gte: since } },
      orderBy: { at: "desc" },
      select: { userId: true, title: true },
    });
    const byUser = new Map<string, string[]>();
    for (const n of unread) byUser.set(n.userId, [...(byUser.get(n.userId) ?? []), n.title]);
    for (const [userId, titles] of byUser) {
      const top = titles.slice(0, DIGEST_ITEMS).join("; ");
      const more = titles.length > DIGEST_ITEMS ? `, and ${titles.length - DIGEST_ITEMS} more` : "";
      add(userId, { key: `digest:${today}`, line: `This week you missed ${titles.length} ${titles.length === 1 ? "update" : "updates"}: ${top}${more}.`, link: "/app" });
    }
  }

  private async deliver(items: Map<string, Item[]>) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...items.keys()] } },
      select: { id: true, email: true, emailVerifiedAt: true, notify: true },
    });
    const sent = await this.prisma.reminderSent.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, key: true } });
    const done = new Set(sent.map((s) => `${s.userId}|${s.key}`));
    const result = { people: 0, emails: 0, postponed: 0 };
    const notified: string[] = [];

    for (const user of users) {
      const prefs = (user.notify ?? {}) as Prefs;
      // Reminders are on unless turned off. The digest is only for people who asked for it.
      const wanted = (items.get(user.id) ?? []).filter((item) => !done.has(`${user.id}|${item.key}`) && (item.key.startsWith("digest:") ? prefs.email === true : prefs.reminders !== false));
      if (!wanted.length) continue;
      result.people++;

      if (this.mail.enabled && user.emailVerifiedAt) {
        const lines = wanted.map((item) => item.line);
        const delivered = await this.mail.sendSummary(user.email, lines.length === 1 ? lines[0] : "Your TripOS reminders", lines, { label: "Open TripOS", path: wanted[0].link });
        // Over the day's allowance or a failed send: nothing is marked as sent, so tomorrow's run tries again.
        if (!delivered) {
          result.postponed++;
          continue;
        }
        result.emails++;
      }

      const inApp = wanted.filter((item) => item.inApp);
      if (inApp.length) {
        await this.prisma.notification.createMany({
          data: inApp.map((item) => ({ userId: user.id, tripId: item.inApp?.tripId, kind: item.inApp?.kind as NotificationKind, title: item.inApp?.title as string, body: item.line, link: item.link })),
        });
        notified.push(user.id);
      }
      await this.prisma.reminderSent.createMany({ data: wanted.map((item) => ({ userId: user.id, key: item.key })), skipDuplicates: true });
    }

    this.realtime.notificationsChanged(notified);
    this.logger.log(`Daily reminders: ${result.people} people, ${result.emails} emails, ${result.postponed} postponed`);
    return result;
  }
}
