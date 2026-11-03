import { randomInt } from "node:crypto";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Friendship, NotificationKind, User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";

export type Relationship = "self" | "none" | "request_sent" | "request_received" | "friends";

const RESEND_AFTER_DECLINE_MS = 30 * 24 * 60 * 60 * 1000;
export const USERNAME = /^[a-z0-9_]{3,30}$/;
export const RESERVED_USERNAMES = new Set(["admin", "administrator", "moderator", "support", "help", "tripos", "official", "me", "settings", "system", "null", "undefined"]);

/** Two people have one row, however it started, so requests can't be duplicated in either direction. */
export const pair = (a: string, b: string) => (a < b ? { userLowId: a, userHighId: b } : { userLowId: b, userHighId: a });
const SUGGESTION_SCAN = 200;
const SUGGESTIONS = 12;
const placesOf = (u: Pick<User, "favouriteDestinations" | "placesVisited">) => [...u.favouriteDestinations, ...u.placesVisited];
const sharedPlaces = (a: User, b: User) => {
  const theirs = new Set(placesOf(b).map((p) => p.toLowerCase()));
  return [...new Set(placesOf(a).filter((p) => theirs.has(p.toLowerCase())))];
};
const otherPerson = (f: Friendship, me: string) => (f.userLowId === me ? f.userHighId : f.userLowId);

/** Someone who can be found: a real, confirmed person who has opened their profile. Invited placeholders never can. */
export const listed = { onboarded: true, emailVerifiedAt: { not: null }, deletedAt: null, suspendedAt: null, username: { not: null } } as const;
const isListed = (u: User) => u.onboarded && !!u.emailVerifiedAt && !u.deletedAt && !u.suspendedAt && !!u.username;

/**
 * Who can see and do what between two travellers. Every profile, search and friend response goes through
 * here, and only the fields named below ever leave. Email addresses are never among them.
 */
@Injectable()
export class SocialService {
  private readonly admins: Set<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    config: ConfigService,
  ) {
    this.admins = new Set(config.get<string>("ADMIN_EMAILS", "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
  }

  /** Needs a confirmed address too, so typing someone's email into an account can't make it an admin. */
  isAdmin(user: User) {
    return !!user.emailVerifiedAt && this.admins.has(user.email);
  }

  /** People hidden from this person, whichever of them did the blocking. */
  async blockedIds(userId: string) {
    const rows = await this.prisma.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
    return new Set(rows.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
  }

  async isBlockedEitherWay(a: string, b: string) {
    return (await this.prisma.block.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } })) > 0;
  }

  /** Blocked, missing, suspended or unconfirmed people all look exactly the same: not found. */
  async findVisible(viewer: User, username: string) {
    const target = await this.prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (target?.id === viewer.id) return target;
    if (!target || !isListed(target) || (await this.isBlockedEitherWay(viewer.id, target.id))) throw new NotFoundException({ message: "We couldn't find that traveller" });
    return target;
  }

  friendIds(userId: string) {
    return this.prisma.friendship
      .findMany({ where: { status: "accepted", OR: [{ userLowId: userId }, { userHighId: userId }] }, select: { userLowId: true, userHighId: true } })
      .then((rows) => new Set(rows.map((f) => (f.userLowId === userId ? f.userHighId : f.userLowId))));
  }

  relationshipOf(viewerId: string, targetId: string, friendship: Friendship | null | undefined): { relationship: Relationship; requestId?: string; } {
    if (viewerId === targetId) return { relationship: "self" };
    if (!friendship) return { relationship: "none" };
    if (friendship.status === "accepted") return { relationship: "friends", requestId: friendship.id };
    // A declined request looks finished to the person who sent it, and stays answerable for whoever declined it.
    if (friendship.status === "declined") return friendship.requesterId === viewerId ? { relationship: "none" } : { relationship: "request_received", requestId: friendship.id };
    return { relationship: friendship.requesterId === viewerId ? "request_sent" : "request_received", requestId: friendship.id };
  }

  canReceiveRequestFrom(target: User, relationship: Relationship) {
    return relationship === "none" && target.friendRequestsFrom === "everyone";
  }

  /** The small card used in lists. A private profile shows only its name, username and photo. */
  async cards(viewer: User, targets: User[]) {
    if (!targets.length) return [];
    const ids = targets.map((t) => t.id);
    const [friendships, viewerFriends, theirFriendships] = await Promise.all([
      this.prisma.friendship.findMany({ where: { OR: ids.map((id) => pair(viewer.id, id)) } }),
      this.friendIds(viewer.id),
      this.prisma.friendship.findMany({ where: { status: "accepted", OR: [{ userLowId: { in: ids } }, { userHighId: { in: ids } }] }, select: { userLowId: true, userHighId: true } }),
    ]);
    const byOther = new Map(friendships.map((f) => [otherPerson(f, viewer.id), f]));
    return targets.map((target) => {
      const { relationship, requestId } = this.relationshipOf(viewer.id, target.id, byOther.get(target.id));
      const full = relationship === "self" || relationship === "friends" || target.profileVisibility === "public";
      const mutual = full ? theirFriendships.filter((f) => (f.userLowId === target.id && viewerFriends.has(f.userHighId)) || (f.userHighId === target.id && viewerFriends.has(f.userLowId))).length : 0;
      return {
        id: target.id,
        username: target.username as string,
        name: target.name,
        avatar: target.avatar,
        relationship,
        requestId,
        canSendRequest: this.canReceiveRequestFrom(target, relationship),
        limited: !full,
        location: full ? target.location : "",
        travelStyles: full ? target.travelStyles : [],
        sharedStyles: full ? target.travelStyles.filter((s) => viewer.travelStyles.includes(s)) : [],
        sharedInterests: full ? target.interests.filter((s) => viewer.interests.includes(s)) : [],
        sharedDestinations: full ? sharedPlaces(target, viewer) : [],
        mutualFriends: mutual,
      };
    });
  }

  /** A whole profile, respecting who's looking. */
  async profile(viewer: User, target: User) {
    const [card] = await this.cards(viewer, [target]);
    const full = !card.limited;
    return {
      ...card,
      visibility: target.profileVisibility,
      bio: full ? target.bio : "",
      coverPhoto: full ? target.coverPhoto : "",
      interests: full ? target.interests : [],
      favouriteDestinations: full ? target.favouriteDestinations : [],
      placesVisited: full ? target.placesVisited : [],
    };
  }

  /** Public profiles with something in common, closest first. Popularity plays no part. */
  async suggestions(viewer: User) {
    const [hidden, friends, requests] = await Promise.all([
      this.blockedIds(viewer.id),
      this.friendIds(viewer.id),
      this.prisma.friendship.findMany({ where: { OR: [{ userLowId: viewer.id }, { userHighId: viewer.id }] }, select: { userLowId: true, userHighId: true } }),
    ]);
    const skip = [viewer.id, ...hidden, ...friends, ...requests.map((f) => otherPerson(f as Friendship, viewer.id))];
    const candidates = await this.prisma.user.findMany({ where: { ...listed, profileVisibility: "public", id: { notIn: skip } }, orderBy: { createdAt: "desc" }, take: SUGGESTION_SCAN });
    const cards = await this.cards(viewer, candidates);
    const score = (c: (typeof cards)[number]) => c.sharedStyles.length * 2 + c.sharedInterests.length * 2 + c.sharedDestinations.length * 2 + c.mutualFriends;
    return cards.filter((c) => score(c) > 0).sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name)).slice(0, SUGGESTIONS);
  }

  /** Everyone who hasn't chosen one gets a username the first time they open their profile, and can change it. */
  async ensureUsername(user: User) {
    if (user.username) return user;
    const base = user.name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20);
    const stem = base.length >= 3 ? base : "traveller";
    for (let attempt = 0; attempt < 8; attempt++) {
      const username = `${stem}${randomInt(1000, 10000)}`;
      if (!(await this.prisma.user.findUnique({ where: { username }, select: { id: true } }))) {
        return this.prisma.user.update({ where: { id: user.id }, data: { username } });
      }
    }
    throw new ConflictException({ message: "Please try again" });
  }

  /** In-app only: a social app could use up the free daily email allowance by itself. */
  async notify(userId: string, input: { kind: NotificationKind; title: string; body: string; link: string }, tripId?: string) {
    const person = await this.prisma.user.findUnique({ where: { id: userId }, select: { notify: true } });
    if (!person || (person.notify as Record<string, boolean>).social === false) return;
    await this.prisma.notification.create({ data: { userId, tripId, ...input } });
    this.realtime.notificationsChanged([userId]);
  }

  requestLink(requesterId: string) {
    return `/app/people?tab=requests&from=${requesterId}`;
  }

  /** Takes back the "wants to be your friend" notification when it no longer applies. */
  async forgetRequestNotification(recipientId: string, requesterId: string) {
    const { count } = await this.prisma.notification.deleteMany({ where: { userId: recipientId, kind: "friend_request", link: this.requestLink(requesterId) } });
    if (count) this.realtime.notificationsChanged([recipientId]);
  }

  canResendAfterDecline(friendship: Friendship) {
    return Date.now() - (friendship.respondedAt ?? friendship.createdAt).getTime() > RESEND_AFTER_DECLINE_MS;
  }
}
