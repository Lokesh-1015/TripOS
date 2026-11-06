// Runs against a live server (`pnpm run db:up`, `pnpm run dev`) with ADMIN_EMAILS including the address below.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";

const BASE = process.env.API_URL ?? "http://localhost:4000";
const COVER = "https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3";
const ADMIN_EMAIL = "reports-admin@example.test";
const tag = randomUUID().slice(0, 8);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }) });
let counter = 0;

class Client {
  cookie = "";
  id = "";
  email = "";
  username = "";
  name = "";
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }
  /** A real, confirmed traveller who has opened their profile. */
  static async traveller(name: string, profile: Record<string, unknown> = {}, options: { email?: string; verified?: boolean } = {}) {
    const c = new Client();
    c.name = `${name} ${tag}`;
    c.email = options.email ?? `${name.toLowerCase()}-${tag}-${++counter}@example.test`;
    const signUp = await c.req("POST", "/auth/signup", { name: c.name, email: c.email, password: "correct-horse" });
    if (signUp.status === 409) expect((await c.req("POST", "/auth/login", { email: c.email, password: "correct-horse" })).status).toBe(200);
    c.id = (await c.req("GET", "/state")).body.user.id;
    // The moderator account is reused between runs, so its last username change is cleared each time.
    await db.user.update({ where: { id: c.id }, data: { onboarded: true, emailVerifiedAt: options.verified === false ? null : new Date(), usernameChangedAt: null } });
    const me = await c.req("PATCH", "/me/profile", { username: `${name.toLowerCase()}_${tag}_${counter}`.slice(0, 30), ...profile });
    expect(me.status).toBe(200);
    c.username = me.body.username;
    return c;
  }
}

const incomingId = async (c: Client, username: string) => (await c.req("GET", "/friends/requests")).body.incoming.find((r: { person: { username: string } }) => r.person.username === username)?.id as string;
const makeFriends = async (a: Client, b: Client) => {
  expect((await a.req("POST", "/friends/requests", { username: b.username })).status).toBeLessThan(300);
  expect((await b.req("POST", `/friends/requests/${await incomingId(b, a.username)}/accept`)).status).toBe(200);
};
const relationship = async (viewer: Client, target: Client) => (await viewer.req("GET", `/profiles/${target.username}`)).body.relationship;
const kindsFor = async (c: Client) => (await c.req("GET", "/notifications")).body.map((n: { kind: string }) => n.kind);

const SECRET_DETAILS = { location: "Secret Valley", interests: ["Secret interest"], favouriteDestinations: ["Secret beach"], placesVisited: ["Secret town"], coverPhoto: COVER };

describe("profiles", () => {
  it("starts private, for new accounts and everyone who was here already", async () => {
    const c = await Client.traveller("Fresh");
    expect((await c.req("GET", "/me/profile")).body.visibility).toBe("private");
    expect((await c.req("GET", "/state")).status).toBe(200);
  });

  it("shows a stranger only the name, username and photo of a private profile", async () => {
    const hidden = await Client.traveller("Hidden", SECRET_DETAILS);
    await hidden.req("PATCH", "/me", { bio: "Secret bio", travelStyles: ["Beaches"] });
    const stranger = await Client.traveller("Stranger");
    const seen = await stranger.req("GET", `/profiles/${hidden.username}`);
    expect(seen.status).toBe(200);
    expect(seen.body).toMatchObject({ name: hidden.name, username: hidden.username, limited: true, bio: "", location: "", coverPhoto: "", interests: [], favouriteDestinations: [], placesVisited: [], travelStyles: [], mutualFriends: 0 });
    expect(JSON.stringify(seen.body)).not.toContain("Secret");
    expect(JSON.stringify(seen.body)).not.toContain(hidden.email);
  });

  it("shows a public profile to anyone, and a private one to friends", async () => {
    const open = await Client.traveller("Open", { ...SECRET_DETAILS, profileVisibility: "public" });
    const shy = await Client.traveller("Shy", SECRET_DETAILS);
    const friend = await Client.traveller("Pal");
    expect((await friend.req("GET", `/profiles/${open.username}`)).body).toMatchObject({ limited: false, location: "Secret Valley" });
    await makeFriends(friend, shy);
    expect((await friend.req("GET", `/profiles/${shy.username}`)).body).toMatchObject({ limited: false, location: "Secret Valley", relationship: "friends" });
    await friend.req("DELETE", `/friends/${shy.id}`);
    expect((await friend.req("GET", `/profiles/${shy.username}`)).body).toMatchObject({ limited: true, location: "" });
  });

  it("never includes an email address, in any response", async () => {
    const a = await Client.traveller("Mailless", { profileVisibility: "public" });
    const b = await Client.traveller("Looker");
    await makeFriends(b, a);
    const responses = await Promise.all([b.req("GET", `/profiles/${a.username}`), b.req("GET", "/friends"), b.req("GET", `/people/search?q=${a.username.slice(0, 8)}`), b.req("GET", "/friends/requests")]);
    responses.forEach((r) => expect(JSON.stringify(r.body)).not.toContain(a.email));
  });

  it("checks usernames: format, reserved words and duplicates", async () => {
    const a = await Client.traveller("Picker");
    const b = await Client.traveller("Second");
    expect((await a.req("PATCH", "/me/profile", { username: "no spaces!" })).status).toBe(422);
    expect((await a.req("PATCH", "/me/profile", { username: "ab" })).status).toBe(422);
    expect((await a.req("PATCH", "/me/profile", { username: "admin" })).status).toBe(409);
    expect((await a.req("PATCH", "/me/profile", { username: b.username })).status).toBe(409);
    expect((await a.req("PATCH", "/me/profile", { username: a.username.toUpperCase() })).status).toBe(200);
  });

  it("refuses a cover image from anywhere else", async () => {
    const a = await Client.traveller("Cover");
    expect((await a.req("PATCH", "/me/profile", { coverPhoto: "https://evil.example/x.png" })).status).toBe(422);
  });

  it("gives someone a username the first time they open their profile", async () => {
    const c = new Client();
    c.email = `nousername-${tag}@example.test`;
    await c.req("POST", "/auth/signup", { name: "Asha Rao", email: c.email, password: "correct-horse" });
    const me = await c.req("GET", "/me/profile");
    expect(me.body.username).toMatch(/^asharao\d{4}$/);
    expect((await c.req("GET", "/me/profile")).body.username).toBe(me.body.username);
  });
});

describe("search", () => {
  const search = (c: Client, q: string) => c.req("GET", `/people/search?q=${encodeURIComponent(q)}`);

  it("finds people by name and username, but never by email", async () => {
    const target = await Client.traveller("Findable");
    const viewer = await Client.traveller("Seeker");
    expect((await search(viewer, target.name)).body.map((p: { id: string }) => p.id)).toContain(target.id);
    expect((await search(viewer, target.username)).body.map((p: { id: string }) => p.id)).toContain(target.id);
    expect((await search(viewer, target.email)).body).toEqual([]);
    expect((await search(viewer, "x")).status).toBe(422);
  });

  it("leaves out invited placeholders, unconfirmed and deleted accounts", async () => {
    const owner = await Client.traveller("Inviter");
    const placeholderEmail = `placeholder${tag}@example.test`;
    const tripId = `trip-${randomUUID().slice(0, 12)}`;
    expect((await owner.req("POST", "/trips", { id: tripId, name: "Trip", destination: "Goa", cover: COVER, startDate: "2030-03-01", endDate: "2030-03-04" })).status).toBe(201);
    expect((await owner.req("POST", `/trips/${tripId}/members`, { email: placeholderEmail })).status).toBeLessThan(500);
    const viewer = await Client.traveller("Viewer");
    expect((await search(viewer, `placeholder${tag}`)).body).toEqual([]);

    const unconfirmed = await Client.traveller("Unconfirmed", {}, { verified: false });
    expect((await search(viewer, unconfirmed.username)).body).toEqual([]);
    expect((await viewer.req("GET", `/profiles/${unconfirmed.username}`)).status).toBe(404);

    const leaving = await Client.traveller("Leaving");
    const before = leaving.username;
    expect((await leaving.req("POST", "/me/delete", { password: "correct-horse" })).status).toBe(200);
    expect((await search(viewer, before)).body).toEqual([]);
    expect((await viewer.req("GET", `/profiles/${before}`)).status).toBe(404);
  });
});

describe("friend requests", () => {
  it("moves through the four states, for both people", async () => {
    const a = await Client.traveller("Alpha");
    const b = await Client.traveller("Beta");
    expect(await relationship(a, b)).toBe("none");
    expect((await a.req("POST", "/friends/requests", { username: b.username })).status).toBeLessThan(300);
    expect(await relationship(a, b)).toBe("request_sent");
    expect(await relationship(b, a)).toBe("request_received");
    expect(await kindsFor(b)).toContain("friend_request");
    const id = await incomingId(b, a.username);
    expect((await b.req("POST", `/friends/requests/${id}/accept`)).status).toBe(200);
    expect(await relationship(a, b)).toBe("friends");
    expect(await relationship(b, a)).toBe("friends");
    expect(await kindsFor(a)).toContain("friend_accept");
    expect(await kindsFor(b)).not.toContain("friend_request");
    expect((await a.req("GET", "/friends")).body.map((f: { id: string }) => f.id)).toEqual([b.id]);
    expect((await b.req("GET", "/friends")).body.map((f: { id: string }) => f.id)).toEqual([a.id]);
  });

  it("doesn't allow repeats, and two people asking each other become friends", async () => {
    const a = await Client.traveller("Repeat");
    const b = await Client.traveller("Target");
    expect((await a.req("POST", "/friends/requests", { username: b.username })).status).toBeLessThan(300);
    expect((await a.req("POST", "/friends/requests", { username: b.username })).status).toBe(409);
    expect((await b.req("POST", "/friends/requests", { username: a.username })).status).toBeLessThan(300);
    expect(await relationship(a, b)).toBe("friends");
    expect((await a.req("POST", "/friends/requests", { username: b.username })).status).toBe(409);
    expect(await db.friendship.count({ where: { OR: [{ userLowId: a.id }, { userHighId: a.id }] } })).toBe(1);
  });

  it("handles a burst of the same request as one", async () => {
    const a = await Client.traveller("Burst");
    const b = await Client.traveller("BurstTarget");
    const results = await Promise.all(Array.from({ length: 5 }, () => a.req("POST", "/friends/requests", { username: b.username })));
    expect(results.filter((r) => r.status < 300).length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.status < 500)).toBe(true);
    expect(await db.friendship.count({ where: { OR: [{ userLowId: a.id }, { userHighId: a.id }] } })).toBe(1);
  });

  it("lets the sender cancel, and takes the notification back", async () => {
    const a = await Client.traveller("Canceller");
    const b = await Client.traveller("Spared");
    await a.req("POST", "/friends/requests", { username: b.username });
    const sent = (await a.req("GET", "/friends/requests")).body.sent[0];
    expect((await b.req("DELETE", `/friends/requests/${sent.id}`)).status).toBe(404);
    expect((await a.req("DELETE", `/friends/requests/${sent.id}`)).status).toBe(200);
    expect(await relationship(a, b)).toBe("none");
    expect(await kindsFor(b)).not.toContain("friend_request");
    expect((await a.req("POST", "/friends/requests", { username: b.username })).status).toBeLessThan(300);
  });

  it("after a decline, the sender can't keep asking, and the decliner can still change their mind", async () => {
    const a = await Client.traveller("Persistent");
    const b = await Client.traveller("Decliner");
    await a.req("POST", "/friends/requests", { username: b.username });
    const id = await incomingId(b, a.username);
    expect((await a.req("POST", `/friends/requests/${id}/decline`)).status).toBe(404);
    expect((await b.req("POST", `/friends/requests/${id}/decline`)).status).toBe(200);
    expect(await relationship(a, b)).toBe("none");
    expect((await a.req("POST", "/friends/requests", { username: b.username })).status).toBe(409);
    expect((await b.req("GET", "/friends/requests")).body.declined[0].id).toBe(id);
    expect((await a.req("GET", "/friends/requests")).body.sent).toEqual([]);

    await db.friendship.update({ where: { id }, data: { respondedAt: new Date(Date.now() - 31 * 86_400_000) } });
    expect((await a.req("POST", "/friends/requests", { username: b.username })).status).toBeLessThan(300);
    expect((await b.req("POST", `/friends/requests/${id}/accept`)).status).toBe(200);
    expect(await relationship(a, b)).toBe("friends");
  });

  it("respects someone who isn't taking requests", async () => {
    const closed = await Client.traveller("Closed", { friendRequestsFrom: "nobody" });
    const a = await Client.traveller("Knocker");
    expect((await a.req("GET", `/profiles/${closed.username}`)).body.canSendRequest).toBe(false);
    expect((await a.req("POST", "/friends/requests", { username: closed.username })).status).toBe(403);
  });

  it("needs a confirmed email to send or accept", async () => {
    const unconfirmed = await Client.traveller("Unproven", {}, { verified: false });
    const a = await Client.traveller("Confirmed");
    expect((await unconfirmed.req("POST", "/friends/requests", { username: a.username })).status).toBe(403);
  });

  it("can't be answered by anyone else", async () => {
    const a = await Client.traveller("Asker");
    const b = await Client.traveller("Asked");
    const other = await Client.traveller("Other");
    await a.req("POST", "/friends/requests", { username: b.username });
    const id = await incomingId(b, a.username);
    expect((await other.req("POST", `/friends/requests/${id}/accept`)).status).toBe(404);
    expect((await a.req("POST", `/friends/requests/${id}/accept`)).status).toBe(404);
  });

  it("can turn the notifications off", async () => {
    const quiet = await Client.traveller("Quiet");
    expect((await quiet.req("PATCH", "/me", { notify: { social: false } })).status).toBe(200);
    const a = await Client.traveller("Loud");
    await a.req("POST", "/friends/requests", { username: quiet.username });
    expect(await kindsFor(quiet)).not.toContain("friend_request");
  });

  it("shows what two travellers have in common", async () => {
    const a = await Client.traveller("Common", { profileVisibility: "public" });
    const b = await Client.traveller("Likewise");
    const shared = await Client.traveller("Mutual");
    await a.req("PATCH", "/me", { travelStyles: ["Beaches", "Heritage"] });
    await b.req("PATCH", "/me", { travelStyles: ["Beaches"] });
    await makeFriends(a, shared);
    await makeFriends(b, shared);
    expect((await b.req("GET", `/profiles/${a.username}`)).body).toMatchObject({ sharedStyles: ["Beaches"], mutualFriends: 1 });
  });
});

describe("friendship gives no access to trips", () => {
  it("keeps a friend out of a private trip and its files", async () => {
    const owner = await Client.traveller("TripOwner");
    const friend = await Client.traveller("TripFriend");
    await makeFriends(owner, friend);
    const tripId = `trip-${randomUUID().slice(0, 12)}`;
    expect((await owner.req("POST", "/trips", { id: tripId, name: "Private", destination: "Goa", cover: COVER, startDate: "2030-03-01", endDate: "2030-03-04" })).status).toBe(201);
    expect((await friend.req("GET", `/trips/${tripId}`)).status).toBeGreaterThanOrEqual(403);
    expect((await friend.req("GET", "/state")).body.trips).toEqual([]);
  });
});

describe("blocking", () => {
  it("hides each person from the other, and ends what was between them", async () => {
    const a = await Client.traveller("Blocker");
    const b = await Client.traveller("Blocked", { profileVisibility: "public" });
    await makeFriends(a, b);
    expect((await a.req("POST", "/blocks", { userId: b.id })).status).toBe(200);

    expect((await a.req("GET", "/friends")).body).toEqual([]);
    expect((await b.req("GET", "/friends")).body).toEqual([]);
    expect((await a.req("GET", `/profiles/${b.username}`)).status).toBe(404);
    expect((await b.req("GET", `/profiles/${a.username}`)).status).toBe(404);
    expect((await a.req("GET", `/people/search?q=${b.username}`)).body).toEqual([]);
    expect((await b.req("GET", `/people/search?q=${a.username}`)).body).toEqual([]);
    expect((await b.req("POST", "/friends/requests", { username: a.username })).status).toBe(404);
    expect((await a.req("GET", "/blocks")).body.map((p: { id: string }) => p.id)).toEqual([b.id]);
    // The blocked person can't tell who blocked them, or see the list.
    expect((await b.req("GET", "/blocks")).body).toEqual([]);

    expect((await a.req("DELETE", `/blocks/${b.id}`)).status).toBe(200);
    expect((await a.req("GET", `/profiles/${b.username}`)).status).toBe(200);
    expect(await relationship(a, b)).toBe("none");
  });

  it("takes back a pending request and its notification", async () => {
    const a = await Client.traveller("Pest");
    const b = await Client.traveller("Annoyed");
    await a.req("POST", "/friends/requests", { username: b.username });
    expect(await kindsFor(b)).toContain("friend_request");
    await b.req("POST", "/blocks", { userId: a.id });
    expect(await kindsFor(b)).not.toContain("friend_request");
    expect((await a.req("GET", "/friends/requests")).body.sent).toEqual([]);
  });

  it("leaves shared trips as they are", async () => {
    const owner = await Client.traveller("Shared");
    const member = await Client.traveller("Member");
    const tripId = `trip-${randomUUID().slice(0, 12)}`;
    const trip = await owner.req("POST", "/trips", { id: tripId, name: "Together", destination: "Goa", cover: COVER, startDate: "2030-03-01", endDate: "2030-03-04" });
    expect((await member.req("POST", `/invites/${trip.body.joinCode}/accept`)).status).toBeLessThan(300);
    await owner.req("POST", "/blocks", { userId: member.id });
    expect((await member.req("GET", `/trips/${tripId}`)).status).toBe(200);
    expect((await owner.req("GET", `/trips/${tripId}`)).body.members.map((m: { id: string }) => m.id)).toContain(member.id);
  });

  it("can't target yourself", async () => {
    const a = await Client.traveller("Self");
    expect((await a.req("POST", "/blocks", { userId: a.id })).status).toBe(422);
    expect((await a.req("POST", "/friends/requests", { username: a.username })).status).toBe(422);
    expect((await a.req("POST", "/reports", { targetType: "profile", targetId: a.id, reason: "spam" })).status).toBe(404);
  });
});

describe("reports and moderation", () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await Client.traveller("Moderator", {}, { email: ADMIN_EMAIL });
  });

  it("saves a report, emails it, and shows it only to admins", async () => {
    const reporter = await Client.traveller("Reporter");
    const target = await Client.traveller("Reported");
    const details = `Sent me spam ${tag}`;
    expect((await reporter.req("POST", "/reports", { targetType: "profile", targetId: target.id, reason: "spam", details })).status).toBeLessThan(300);
    expect((await reporter.req("POST", "/reports", { targetType: "profile", targetId: target.id, reason: "nonsense" })).status).toBe(422);

    expect((await reporter.req("GET", "/admin/reports")).status).toBe(404);
    expect((await target.req("GET", "/admin/reports")).status).toBe(404);
    const list = await admin.req("GET", "/admin/reports");
    expect(list.status).toBe(200);
    const row = list.body.find((r: { details: string }) => r.details === details);
    expect(row).toMatchObject({ reason: "spam", status: "open", target: { id: target.id, suspended: false } });

    expect((await admin.req("POST", `/admin/reports/${row.id}/review`)).status).toBe(200);
    expect((await admin.req("GET", "/admin/reports")).body.find((r: { id: string }) => r.id === row.id).status).toBe("reviewed");
  });

  it("an email merely typed into an account isn't an admin until it's confirmed", async () => {
    const impostor = new Client();
    await impostor.req("POST", "/auth/signup", { name: "Impostor", email: `impostor-${tag}@example.test`, password: "correct-horse" });
    const row = await db.user.findUniqueOrThrow({ where: { email: `impostor-${tag}@example.test` } });
    expect(row.emailVerifiedAt).toBeNull();
    expect((await impostor.req("GET", "/admin/reports")).status).toBe(404);
  });

  it("suspending someone signs them out, hides them and stops them signing in, until it's lifted", async () => {
    const rulebreaker = await Client.traveller("Breaker");
    const viewer = await Client.traveller("Witness");
    expect((await viewer.req("POST", `/admin/users/${rulebreaker.id}/suspend`)).status).toBe(404);
    expect((await admin.req("POST", `/admin/users/${rulebreaker.id}/suspend`)).status).toBe(200);

    expect((await rulebreaker.req("GET", "/state")).status).toBe(401);
    const again = await new Client().req("POST", "/auth/login", { email: rulebreaker.email, password: "correct-horse" });
    expect(again.status).toBe(403);
    expect((await viewer.req("GET", `/profiles/${rulebreaker.username}`)).status).toBe(404);

    expect((await admin.req("POST", `/admin/users/${rulebreaker.id}/unsuspend`)).status).toBe(200);
    expect((await new Client().req("POST", "/auth/login", { email: rulebreaker.email, password: "correct-horse" })).status).toBe(200);
  });
});

describe("deleting an account", () => {
  it("removes the profile, friendships, blocks and username, so the name can be reused", async () => {
    const leaver = await Client.traveller("Goner", SECRET_DETAILS);
    const friend = await Client.traveller("Remaining");
    await makeFriends(friend, leaver);
    const username = leaver.username;
    expect((await leaver.req("POST", "/me/delete", { password: "correct-horse" })).status).toBe(200);
    const row = await db.user.findUniqueOrThrow({ where: { id: leaver.id } });
    expect(row.username).toMatch(/^former\./);
    expect(row).toMatchObject({ location: "", coverPhoto: "", interests: [], favouriteDestinations: [], placesVisited: [], profileVisibility: "private" });
    expect((await friend.req("GET", "/friends")).body).toEqual([]);
    expect(await db.friendship.count({ where: { OR: [{ userLowId: leaver.id }, { userHighId: leaver.id }] } })).toBe(0);
    // The friend picked a username moments ago, so the 30 days are set aside here to test reuse.
    await db.user.update({ where: { id: friend.id }, data: { usernameChangedAt: null } });
    expect((await friend.req("PATCH", "/me/profile", { username })).status).toBe(200);
  });
});

describe("what was already here", () => {
  it("still works for someone who never opens any of this", async () => {
    const c = new Client();
    await c.req("POST", "/auth/signup", { name: "Trips Only", email: `tripsonly-${tag}@example.test`, password: "correct-horse" });
    const state = await c.req("GET", "/state");
    expect(state.status).toBe(200);
    expect(state.body.username).toBeUndefined();
    expect(state.body.friends).toBeUndefined();
    const row = await db.user.findUniqueOrThrow({ where: { email: `tripsonly-${tag}@example.test` } });
    // Every account now has a username from signup. It still isn't findable until they finish onboarding and confirm their email.
    expect(row.username).toMatch(/^tripsonly\d{4,6}$/);
    expect(row.profileVisibility).toBe("private");
  });

  it("needs a session for all of it", async () => {
    const anonymous = new Client();
    for (const path of ["/me/profile", "/friends", "/friends/requests", "/blocks", "/people/search?q=abc", "/profiles/someone", "/admin/reports"]) {
      expect((await anonymous.req("GET", path)).status).toBe(401);
    }
  });
});

afterAll(() => db.$disconnect());
