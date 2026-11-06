import { ConflictException } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import type { WriteContext } from "./trip-writer.service.js";

const FULL_MESSAGE = "This trip is full. The host can make room by raising the limit.";

/**
 * The one rule every way of joining a trip goes through: links, invitations and join requests. Holding the
 * trip's row until the transaction ends means two people can't both take the last place. Only people who have
 * actually joined count, including the host. Invitations and requests don't hold a place.
 */
export async function assertRoom(tx: Prisma.TransactionClient, tripId: string, joiningUserId?: string) {
  const [trip] = await tx.$queryRaw<{ maxParticipants: number | null }[]>`SELECT "maxParticipants" FROM "trips" WHERE "id" = ${tripId} FOR UPDATE`;
  if (trip?.maxParticipants == null) return;
  // Someone already on the trip, repeating a click, isn't taking a new place.
  if (joiningUserId) {
    const current = await tx.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: joiningUserId } }, select: { status: true } });
    if (current?.status === "active") return;
  }
  const joined = await tx.tripMember.count({ where: { tripId, status: "active" } });
  if (joined >= trip.maxParticipants) throw new ConflictException({ code: "TRIP_FULL", message: FULL_MESSAGE });
}

/** Tells the host and admins someone has joined, grouped so a busy link doesn't flood them. */
export async function tellHostsSomeoneJoined(ctx: Pick<WriteContext, "tx" | "notify" | "tripName">, tripId: string, name: string) {
  const hosts = await ctx.tx.tripMember.findMany({ where: { tripId, status: "active", role: { in: ["owner", "admin"] } }, select: { userId: true } });
  await ctx.notify({ kind: "member_joined", title: `${name} joined ${ctx.tripName}`, body: "Say hello in the trip chat", link: `/app/trips/${tripId}`, to: hosts.map((h) => h.userId), collapseUnread: true });
}

/** Tells the host and admins, once, when the last place has gone. */
export async function tellHostsIfFull(ctx: Pick<WriteContext, "tx" | "notify" | "tripName">, tripId: string) {
  const trip = await ctx.tx.trip.findUniqueOrThrow({ where: { id: tripId }, select: { maxParticipants: true } });
  if (trip.maxParticipants == null) return;
  const joined = await ctx.tx.tripMember.count({ where: { tripId, status: "active" } });
  if (joined < trip.maxParticipants) return;
  const hosts = await ctx.tx.tripMember.findMany({ where: { tripId, status: "active", role: { in: ["owner", "admin"] } }, select: { userId: true } });
  await ctx.notify({ kind: "trip_full", title: `${ctx.tripName} is now full`, body: `All ${trip.maxParticipants} places have gone. You can raise the limit if you'd like more people.`, link: `/app/trips/${tripId}`, to: hosts.map((h) => h.userId), collapseUnread: true });
}
