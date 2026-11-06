// Runs against a live server (`pnpm run db:up`, `pnpm run dev`).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";

vi.setConfig({ testTimeout: 30_000 });

const BASE = process.env.API_URL ?? "http://localhost:4000";
const COVER = "https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3";
const tag = randomUUID().slice(0, 6);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }) });
let counter = 0;
const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 12)}`;

class Client {
  cookie = "";
  id = "";
  email = "";
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
  async me() {
    return (await this.req("GET", "/me/profile")).body;
  }
  static async person(name: string) {
    const c = new Client();
    c.name = `${name} Tester`;
    c.email = `${name.toLowerCase()}-${tag}-${++counter}@example.test`;
    expect((await c.req("POST", "/auth/signup", { name: c.name, email: c.email, password: "correct-horse" })).status).toBeLessThan(300);
    c.id = (await c.req("GET", "/state")).body.user.id;
    await db.user.update({ where: { id: c.id }, data: { onboarded: true, emailVerifiedAt: new Date() } });
    return c;
  }
}
const unique = (stem: string) => `${stem}${tag}${++counter}`.toLowerCase();

describe("usernames", () => {
  it("every new account gets one straight away, including invited placeholders", async () => {
    const owner = await Client.person("Owner");
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).username).toMatch(/^ownertester\d{4,6}$/);
    const tripId = id("trip");
    await owner.req("POST", "/trips", { id: tripId, name: "Placeholder Trip", destination: "Goa", cover: COVER, startDate: "2031-01-01", endDate: "2031-01-02" });
    const invited = `invitee-${tag}@example.test`;
    expect((await owner.req("POST", `/trips/${tripId}/members`, { email: invited })).status).toBeLessThan(300);
    expect((await db.user.findUniqueOrThrow({ where: { email: invited } })).username).toMatch(/^invitee[a-z0-9]+\d{4,6}$/);
  });

  it("accepts letters, numbers, underscores and periods, and refuses everything else", async () => {
    const c = await Client.person("Rules");
    const check = async (u: string) => (await c.req("GET", `/usernames/check?username=${encodeURIComponent(u)}`)).body;
    for (const good of ["asha.rao", "asha_rao", "a.b.c", "rao2026", "x_y.z9"]) expect((await check(`${good}${tag}`.slice(0, 30))).available).toBe(true);
    for (const bad of [".asha", "asha.", "asha..rao", "ab", "asha rao", "asha-rao", "äsha", "a".repeat(31), "admin", "former.someone"]) {
      const result = await check(bad);
      expect(result.available).toBe(false);
      expect(result.reason).toBeTruthy();
    }
    expect((await c.req("PATCH", "/me/profile", { username: "asha..rao" })).status).toBe(422);
  });

  it("is case-insensitive: a different case is the same username, for checking, profiles and taking it", async () => {
    const a = await Client.person("Casey");
    const b = await Client.person("Other");
    const name = unique("Casey.Case");
    expect((await a.req("PATCH", "/me/profile", { username: name.toUpperCase() })).body.username).toBe(name);
    expect((await b.req("GET", `/usernames/check?username=${name.toUpperCase()}`)).body).toMatchObject({ available: false, reason: "That username is taken" });
    expect((await b.req("PATCH", "/me/profile", { username: `@${name.toUpperCase()}` })).status).toBe(409);
    expect((await b.req("GET", `/profiles/${name.toUpperCase()}`)).body.id).toBe(a.id);
    expect((await a.req("GET", `/usernames/check?username=${name}`)).body).toMatchObject({ available: true, mine: true });
  });

  it("can change once every 30 days, with the next date shown", async () => {
    const c = await Client.person("Changer");
    expect((await c.me()).nextUsernameChangeAt).toBeNull();
    const first = unique("first");
    const changed = await c.req("PATCH", "/me/profile", { username: first });
    expect(changed.body.username).toBe(first);
    expect(changed.body.nextUsernameChangeAt).not.toBeNull();
    const days = (new Date(changed.body.nextUsernameChangeAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    const refused = await c.req("PATCH", "/me/profile", { username: unique("second") });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "USERNAME_COOLDOWN", nextChangeAt: changed.body.nextUsernameChangeAt });
    // Saving the profile with the same username isn't a change.
    expect((await c.req("PATCH", "/me/profile", { username: first.toUpperCase(), location: "Pune" })).status).toBe(200);

    await db.user.update({ where: { id: c.id }, data: { usernameChangedAt: new Date(Date.now() - 31 * 86_400_000) } });
    expect((await c.req("PATCH", "/me/profile", { username: unique("third") })).status).toBe(200);
  });

  it("can be chosen freely while setting up, and the 30 days start once setup is done", async () => {
    const c = new Client();
    c.email = `setup-${tag}-${++counter}@example.test`;
    expect((await c.req("POST", "/auth/signup", { name: "Setup Tester", email: c.email, password: "correct-horse" })).status).toBeLessThan(300);
    const first = unique("pick.one");
    const picked = await c.req("PATCH", "/me/profile", { username: first });
    expect(picked.body).toMatchObject({ username: first, nextUsernameChangeAt: null });
    expect((await c.req("PATCH", "/me/profile", { username: unique("pick.two") })).body.nextUsernameChangeAt).toBeNull();
    expect((await c.req("PATCH", "/me", { onboarded: true })).status).toBe(200);
    const changed = await c.req("PATCH", "/me/profile", { username: unique("after.setup") });
    expect(changed.body.nextUsernameChangeAt).not.toBeNull();
    expect((await c.req("PATCH", "/me/profile", { username: unique("too.soon") })).status).toBe(409);
  });

  it("is enforced by the database itself, not only by the app", async () => {
    const c = await Client.person("Direct");
    await db.user.update({ where: { id: c.id }, data: { username: unique("once") } });
    await expect(db.user.update({ where: { id: c.id }, data: { username: unique("twice") } })).rejects.toThrow(/username_cooldown|30 days/);
    await expect(db.user.update({ where: { id: c.id }, data: { username: "Not.Lower" } })).rejects.toThrow();
    const other = await Client.person("Taken");
    const theirs = (await db.user.findUniqueOrThrow({ where: { id: other.id } })).username;
    await db.user.update({ where: { id: c.id }, data: { usernameChangedAt: null } });
    await expect(db.user.update({ where: { id: c.id }, data: { username: theirs } })).rejects.toThrow();
  });

  it("finds people by username or display name, never by email", async () => {
    const target = await Client.person("Findme");
    const seeker = await Client.person("Seeker");
    const name = unique("find.me");
    await target.req("PATCH", "/me/profile", { username: name });
    const search = async (q: string) => (await seeker.req("GET", `/people/search?q=${encodeURIComponent(q)}`)).body.map((p: { id: string }) => p.id);
    expect(await search(name)).toContain(target.id);
    expect(await search(`@${name.toUpperCase()}`)).toContain(target.id);
    expect(await search(target.name)).toContain(target.id);
    expect(await search(target.email)).not.toContain(target.id);
    expect(await search(target.email.split("@")[0])).not.toContain(target.id);
  });

  it("changing it keeps every relationship and record", async () => {
    const a = await Client.person("Keeper");
    const b = await Client.person("Friend");
    const before = (await a.me()).username;
    await a.req("POST", "/friends/requests", { username: (await b.me()).username });
    const incoming = (await b.req("GET", "/friends/requests")).body.incoming[0];
    await b.req("POST", `/friends/requests/${incoming.id}/accept`);
    const tripId = id("trip");
    const trip = await a.req("POST", "/trips", { id: tripId, name: "Kept Trip", destination: "Goa", cover: COVER, startDate: "2031-01-01", endDate: "2031-01-02" });
    await b.req("POST", `/invites/${trip.body.joinCode}/accept`);

    const after = unique("renamed");
    expect((await a.req("PATCH", "/me/profile", { username: after })).status).toBe(200);
    expect((await b.req("GET", "/friends")).body.map((f: { id: string; username: string }) => [f.id, f.username])).toContainEqual([a.id, after]);
    expect((await b.req("GET", `/profiles/${after}`)).body.relationship).toBe("friends");
    expect((await b.req("GET", `/profiles/${before}`)).status).toBe(404);
    expect((await b.req("GET", `/trips/${tripId}`)).body.members.map((m: { id: string }) => m.id)).toContain(a.id);
  });

  it("a deleted account frees its username for someone else", async () => {
    const leaver = await Client.person("Leaver");
    const name = (await leaver.me()).username;
    expect((await leaver.req("POST", "/me/delete", { password: "correct-horse" })).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: leaver.id } })).username).toMatch(/^former\./);
    const next = await Client.person("Next");
    expect((await next.req("PATCH", "/me/profile", { username: name })).status).toBe(200);
  });
});

describe("leaving a trip", () => {
  async function trip(owner: Client, ...others: [Client, "admin" | "member" | "viewer"][]) {
    const tripId = id("trip");
    const made = await owner.req("POST", "/trips", { id: tripId, name: `Leave Trip ${tag}`, destination: "Goa", cover: COVER, startDate: "2031-01-01", endDate: "2031-01-04" });
    expect(made.status).toBe(201);
    for (const [person, role] of others) {
      expect((await person.req("POST", `/invites/${made.body.joinCode}/accept`)).status).toBeLessThan(300);
      if (role !== "member") expect((await owner.req("PATCH", `/trips/${tripId}/members/${person.id}`, { role })).status).toBeLessThan(300);
    }
    return { tripId, joinCode: made.body.joinCode as string };
  }
  const load = async (c: Client, tripId: string) => (await c.req("GET", `/trips/${tripId}`)).body;
  const roleOf = async (viewer: Client, tripId: string, who: Client) => (await load(viewer, tripId)).members.find((m: { id: string }) => m.id === who.id)?.role;
  const kinds = async (c: Client) => (await c.req("GET", "/notifications")).body.map((n: { kind: string }) => n.kind);

  it("a member asks an admin, and the admin approves: access goes, contributions stay", async () => {
    const owner = await Client.person("Owner");
    const member = await Client.person("Member");
    const { tripId } = await trip(owner, [member, "member"]);
    const expenseId = id("exp");
    await member.req("PUT", `/trips/${tripId}/expenses/${expenseId}`, { title: "Dinner", amount: 200, category: "food", paidBy: member.id, date: "2031-01-01", splitType: "equal", shares: [{ memberId: owner.id, amount: 100 }, { memberId: member.id, amount: 100 }] });
    const messageId = id("msg");
    await member.req("PUT", `/trips/${tripId}/messages/${messageId}`, { kind: "text", text: "See you there" });

    expect((await member.req("GET", `/trips/${tripId}/leave`)).body.mode).toBe("request");
    expect((await member.req("POST", `/trips/${tripId}/leave`, {})).body.status).toBe("requested");
    expect((await member.req("POST", `/trips/${tripId}/leave`, {})).status).toBe(409);
    expect((await member.req("GET", `/trips/${tripId}`)).status).toBe(200);
    expect(await kinds(owner)).toContain("leave_request");
    const requests = (await load(owner, tripId)).leaveRequests;
    expect(requests).toHaveLength(1);
    expect((await load(member, tripId)).leaveRequests).toEqual(requests);

    expect((await member.req("POST", `/trips/${tripId}/leave-requests/${requests[0].id}/approve`)).status).toBe(403);
    expect((await owner.req("POST", `/trips/${tripId}/leave-requests/${requests[0].id}/approve`)).status).toBe(200);
    expect((await member.req("GET", `/trips/${tripId}`)).status).toBeGreaterThanOrEqual(403);
    expect((await member.req("GET", "/state")).body.trips.map((t: { id: string }) => t.id)).not.toContain(tripId);
    expect(await kinds(member)).toContain("leave_approved");

    const after = await load(owner, tripId);
    expect(after.members.map((m: { id: string }) => m.id)).not.toContain(member.id);
    expect(after.expenses.find((e: { id: string }) => e.id === expenseId)).toBeDefined();
    expect(after.messages.find((m: { id: string }) => m.id === messageId)).toBeDefined();
  });

  it("an admin can decline, and the member can cancel their own request", async () => {
    const owner = await Client.person("Owner");
    const member = await Client.person("Member");
    const viewer = await Client.person("Viewer");
    const { tripId } = await trip(owner, [member, "member"], [viewer, "viewer"]);
    await member.req("POST", `/trips/${tripId}/leave`, {});
    const request = (await load(owner, tripId)).leaveRequests[0];
    expect((await owner.req("POST", `/trips/${tripId}/leave-requests/${request.id}/reject`)).status).toBe(200);
    expect((await member.req("GET", `/trips/${tripId}`)).status).toBe(200);
    expect(await kinds(member)).toContain("leave_rejected");
    expect((await owner.req("POST", `/trips/${tripId}/leave-requests/${request.id}/approve`)).status).toBe(404);

    expect((await viewer.req("POST", `/trips/${tripId}/leave`, {})).body.status).toBe("requested");
    expect((await viewer.req("DELETE", `/trips/${tripId}/leave`)).status).toBe(200);
    expect((await load(owner, tripId)).leaveRequests).toEqual([]);
  });

  it("an admin leaves directly while another admin stays", async () => {
    const owner = await Client.person("Owner");
    const admin = await Client.person("Admin");
    const member = await Client.person("Member");
    const { tripId } = await trip(owner, [admin, "admin"], [member, "member"]);
    expect((await admin.req("GET", `/trips/${tripId}/leave`)).body.mode).toBe("direct");
    expect((await admin.req("POST", `/trips/${tripId}/leave`, {})).body.status).toBe("left");
    expect((await admin.req("GET", `/trips/${tripId}`)).status).toBeGreaterThanOrEqual(403);
    expect(await kinds(owner)).toContain("member_left");
  });

  it("the owner leaving with another admin passes ownership to them in the same step", async () => {
    const owner = await Client.person("Owner");
    const admin = await Client.person("Admin");
    const { tripId } = await trip(owner, [admin, "admin"]);
    expect((await owner.req("GET", `/trips/${tripId}/leave`)).body).toMatchObject({ mode: "direct", nextOwner: { id: admin.id } });
    expect((await owner.req("POST", `/trips/${tripId}/leave`, {})).body.status).toBe("left");
    expect(await roleOf(admin, tripId, admin)).toBe("owner");
    expect((await db.trip.findUniqueOrThrow({ where: { id: tripId } })).createdById).toBe(admin.id);
  });

  it("the only admin must choose someone, who takes over as they leave", async () => {
    const owner = await Client.person("Owner");
    const member = await Client.person("Member");
    const outsider = await Client.person("Outsider");
    const { tripId } = await trip(owner, [member, "member"]);
    const options = (await owner.req("GET", `/trips/${tripId}/leave`)).body;
    expect(options).toMatchObject({ mode: "choose_successor", candidates: [{ id: member.id }] });
    const refused = await owner.req("POST", `/trips/${tripId}/leave`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("NEEDS_SUCCESSOR");
    expect((await owner.req("POST", `/trips/${tripId}/leave`, { successorId: outsider.id })).status).toBe(422);
    expect(await roleOf(owner, tripId, owner)).toBe("owner");

    expect((await owner.req("POST", `/trips/${tripId}/leave`, { successorId: member.id })).body.status).toBe("left");
    expect(await roleOf(member, tripId, member)).toBe("owner");
    expect((await owner.req("GET", `/trips/${tripId}`)).status).toBeGreaterThanOrEqual(403);
  });

  it("the only person can't leave, and is told what they can do instead", async () => {
    const owner = await Client.person("Alone");
    const { tripId } = await trip(owner);
    expect((await owner.req("GET", `/trips/${tripId}/leave`)).body.mode).toBe("only_person");
    const refused = await owner.req("POST", `/trips/${tripId}/leave`, {});
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "ONLY_PERSON" });
    expect(refused.body.message).toContain("delete the trip");
    expect((await owner.req("GET", `/trips/${tripId}`)).status).toBe(200);
  });

  it("two admins leaving at once can't leave the trip with no admin", async () => {
    const owner = await Client.person("Owner");
    const admin = await Client.person("Admin");
    const member = await Client.person("Member");
    const { tripId } = await trip(owner, [admin, "admin"], [member, "member"]);
    const results = await Promise.all([owner.req("POST", `/trips/${tripId}/leave`, {}), admin.req("POST", `/trips/${tripId}/leave`, {})]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    const remaining = (await load(member, tripId)).members;
    expect(remaining.filter((m: { role: string }) => m.role === "owner")).toHaveLength(1);
  });

  it("someone who left can come back by link, but someone removed can't", async () => {
    const owner = await Client.person("Owner");
    const admin = await Client.person("Admin");
    const removed = await Client.person("Removed");
    const { tripId, joinCode } = await trip(owner, [admin, "admin"], [removed, "member"]);
    await admin.req("POST", `/trips/${tripId}/leave`, {});
    expect((await admin.req("POST", `/invites/${joinCode}/accept`)).status).toBeLessThan(300);
    expect(await roleOf(owner, tripId, admin)).toBe("member");
    await owner.req("DELETE", `/trips/${tripId}/members/${removed.id}`);
    expect((await removed.req("POST", `/invites/${joinCode}/accept`)).status).toBe(403);
  });

  it("removing someone cancels their request to leave", async () => {
    const owner = await Client.person("Owner");
    const member = await Client.person("Member");
    const { tripId } = await trip(owner, [member, "member"]);
    await member.req("POST", `/trips/${tripId}/leave`, {});
    await owner.req("DELETE", `/trips/${tripId}/members/${member.id}`);
    expect((await load(owner, tripId)).leaveRequests).toEqual([]);
  });

  it("is only for people on the trip", async () => {
    const owner = await Client.person("Owner");
    const outsider = await Client.person("Outsider");
    const { tripId } = await trip(owner);
    expect((await outsider.req("GET", `/trips/${tripId}/leave`)).status).toBeGreaterThanOrEqual(403);
    expect((await outsider.req("POST", `/trips/${tripId}/leave`, {})).status).toBeGreaterThanOrEqual(403);
  });
});

afterAll(() => db.$disconnect());
