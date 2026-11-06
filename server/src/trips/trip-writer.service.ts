import { ConflictException, Injectable } from "@nestjs/common";
import type { NotificationKind, Prisma } from "../generated/prisma/client.js";
import { MailService } from "../mail/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";

const PREF_KEY: Record<NotificationKind, string> = {
  invite: "invites",
  message: "messages",
  task: "tasks",
  expense: "expenses",
  vote: "votes",
  itinerary: "itinerary",
  document: "documents",
  trip_full: "invites",
  trip_visibility: "invites",
  join_request: "social",
  join_accepted: "social",
  join_rejected: "social",
  post_like: "social",
  post_comment: "social",
  member_joined: "invites",
  leave_request: "invites",
  leave_approved: "invites",
  leave_rejected: "invites",
  member_left: "invites",
  friend_request: "social",
  friend_accept: "social",
};

interface EmailUpdate {
  to: string[];
  title: string;
  body: string;
  link?: string;
}

export interface WriteContext {
  tx: Prisma.TransactionClient;
  tripName: string;
  /** Adds a line to the trip's activity feed, attributed to the acting user. */
  log(text: string, kind: string): Promise<void>;
  /** Notifies other members who have this kind switched on. `to` narrows the audience. */
  notify(input: { kind: NotificationKind; title: string; body: string; link?: string; to?: string[]; collapseUnread?: boolean }): Promise<void>;
}

/**
 * Every trip write goes through here: the change, its feed line and its notifications commit
 * together, and connected clients are only told once that commit has succeeded.
 */
@Injectable()
export class TripWriter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly mail: MailService,
  ) {}

  /** For people who opted in. Chat stays out of email, as it would use up the free daily allowance in no time. */
  private async emailUpdates(updates: EmailUpdate[]) {
    if (!this.mail.enabled || !updates.length) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(updates.flatMap((u) => u.to))] }, emailVerifiedAt: { not: null } },
      select: { id: true, email: true, notify: true },
    });
    for (const update of updates) {
      for (const user of users) {
        if (update.to.includes(user.id) && (user.notify as Record<string, boolean>).emailAlerts === true) {
          await this.mail.sendSummary(user.email, update.title, [update.body], { label: "Open TripOS", path: update.link ?? "/app" });
        }
      }
    }
  }

  async run<T>(tripId: string, actorId: string, fn: (ctx: WriteContext) => Promise<T>, options?: { timeout: number }): Promise<T> {
    const notified = new Set<string>();
    const updates: EmailUpdate[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId }, select: { name: true } });
      return fn({
        tx,
        tripName: trip.name,
        log: async (text, kind) => {
          await tx.tripEvent.create({ data: { tripId, actorId, text, kind } });
        },
        notify: async ({ kind, title, body, link, to, collapseUnread }) => {
          const members = await tx.tripMember.findMany({
            where: { tripId, status: "active", userId: to ? { in: to, not: actorId } : { not: actorId } },
            select: { userId: true, user: { select: { notify: true } } },
          });
          let recipients = members.filter((m) => (m.user.notify as Record<string, boolean>)[PREF_KEY[kind]] !== false).map((m) => m.userId);
          if (collapseUnread && recipients.length) {
            const unread = await tx.notification.findMany({ where: { tripId, kind, read: false, userId: { in: recipients } }, select: { userId: true } });
            const skip = new Set(unread.map((n) => n.userId));
            recipients = recipients.filter((id) => !skip.has(id));
          }
          if (!recipients.length) return;
          await tx.notification.createMany({ data: recipients.map((userId) => ({ userId, tripId, kind, title, body, link })) });
          recipients.forEach((id) => notified.add(id));
          if (kind !== "message" && kind !== "invite") updates.push({ to: recipients, title, body, link });
        },
      });
    }, options);
    this.realtime.tripChanged(tripId);
    this.realtime.notificationsChanged([...notified]);
    // After the commit, and not awaited: a slow email service must not hold up the person saving.
    void this.emailUpdates(updates).catch(() => undefined);
    return result;
  }
}

/** Optimistic concurrency: a stale `version` means someone else saved first, so the write is refused. */
export async function updateVersioned(
  delegate: { updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }> },
  where: { id: string; tripId: string },
  version: number | undefined,
  data: Record<string, unknown>,
) {
  const { count } = await delegate.updateMany({
    where: { ...where, ...(version === undefined ? {} : { version }) },
    data: { ...data, version: { increment: 1 } },
  });
  if (count === 0) throw new ConflictException({ code: "VERSION_CONFLICT", message: "Someone else just changed this. Your screen has been refreshed - please try again." });
}
