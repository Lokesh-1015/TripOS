// Runs against a live server (`pnpm run db:up`, `pnpm run dev`) with ADMIN_EMAILS including the address below.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";

// These create several accounts per test, which takes a while when everything runs at once.
vi.setConfig({ testTimeout: 30_000 });

const BASE = process.env.API_URL ?? "http://localhost:4000";
const COVER = "https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3";
const ADMIN_EMAIL = "reports-admin@example.test";
const tag = randomUUID().slice(0, 8);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }) });
let counter = 0;
const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 12)}`;

class Client {
  cookie = "";
  id = "";
  email = "";
  name = "";
  username = "";
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
  static async person(name: string, options: { email?: string; verified?: boolean } = {}) {
    const c = new Client();
    c.name = `${name} ${tag}`;
    c.email = options.email ?? `${name.toLowerCase()}-${tag}-${++counter}@example.test`;
    const signUp = await c.req("POST", "/auth/signup", { name: c.name, email: c.email, password: "correct-horse" });
    if (signUp.status === 409) expect((await c.req("POST", "/auth/login", { email: c.email, password: "correct-horse" })).status).toBe(200);
    c.id = (await c.req("GET", "/state")).body.user.id;
    await db.user.update({ where: { id: c.id }, data: { onboarded: true, emailVerifiedAt: options.verified === false ? null : new Date() } });
    c.username = (await c.req("GET", "/me/profile")).body.username;
    return c;
  }
}

const PUBLIC = { visibility: "public", category: "Trekking", travelStyle: "Mountains", showPlan: true };
async function newTrip(owner: Client, extra: Record<string, unknown> = {}) {
  const tripId = id("trip");
  const trip = await owner.req("POST", "/trips", { id: tripId, name: `Trek ${tag}`, destination: `Spiti ${tag}`, cover: COVER, startDate: "2031-03-10", endDate: "2031-03-14", ...extra });
  expect(trip.status).toBe(201);
  return { id: tripId, joinCode: trip.body.joinCode as string };
}
const load = async (c: Client, tripId: string) => (await c.req("GET", `/trips/${tripId}`)).body;
const browse = async (c: Client, query = "") => (await c.req("GET", `/public/trips?destination=${tag}${query}`)).body.trips as { id: string }[];
const inExplore = async (c: Client, tripId: string, query = "") => (await browse(c, query)).some((t) => t.id === tripId);
const ask = (c: Client, tripId: string, message = "") => c.req("POST", `/public/trips/${tripId}/join-request`, { message });
const pendingId = async (host: Client, tripId: string, person: Client) => (await host.req("GET", `/trips/${tripId}/join-requests`)).body.pending.find((r: { person: { id: string } }) => r.person.id === person.id)?.id as string;
const stateOf = async (c: Client, tripId: string) => (await c.req("GET", `/public/trips/${tripId}`)).body.viewer.state as string;

describe("public and private trips", () => {
  it("keeps existing behaviour: new trips are private, and never appear in Explore or a public page", async () => {
    const owner = await Client.person("Owner");
    const viewer = await Client.person("Viewer");
    const trip = await newTrip(owner);
    expect((await load(owner, trip.id)).visibility).toBe("private");
    expect(await inExplore(viewer, trip.id)).toBe(false);
    expect((await viewer.req("GET", `/public/trips/${trip.id}`)).status).toBe(404);
    expect((await new Client().req("GET", `/public/trips/${trip.id}`)).status).toBe(404);
    expect((await ask(viewer, trip.id)).status).toBe(404);
  });

  it("lists a public trip, and removes it as soon as it goes private, keeping everyone on it", async () => {
    const owner = await Client.person("Owner");
    const viewer = await Client.person("Viewer");
    const member = await Client.person("Member");
    const trip = await newTrip(owner, PUBLIC);
    expect((await member.req("POST", `/invites/${trip.joinCode}/accept`)).status).toBeLessThan(300);
    expect(await inExplore(viewer, trip.id)).toBe(true);

    const current = await load(owner, trip.id);
    expect((await owner.req("PATCH", `/trips/${trip.id}`, { visibility: "private", version: current.version })).status).toBeLessThan(300);
    expect(await inExplore(viewer, trip.id)).toBe(false);
    expect((await viewer.req("GET", `/public/trips/${trip.id}`)).status).toBe(404);
    expect((await load(owner, trip.id)).members.map((m: { id: string }) => m.id)).toContain(member.id);
    expect((await member.req("GET", "/notifications")).body.map((n: { kind: string }) => n.kind)).toContain("trip_visibility");
  });

  it("needs a confirmed email to go public, and only the host and admins can change it", async () => {
    const unconfirmed = await Client.person("Unconfirmed", { verified: false });
    expect((await unconfirmed.req("POST", "/trips", { id: id("trip"), name: "Nope Trip", destination: "Goa", cover: COVER, startDate: "2031-01-01", endDate: "2031-01-02", ...PUBLIC })).status).toBe(403);
    const owner = await Client.person("Owner");
    const trip = await newTrip(owner);
    const member = await Client.person("Member");
    await member.req("POST", `/invites/${trip.joinCode}/accept`);
    expect((await member.req("PATCH", `/trips/${trip.id}`, { visibility: "public" })).status).toBe(403);
    expect((await owner.req("PATCH", `/trips/${trip.id}`, { visibility: "everyone" })).status).toBe(422);
  });

  it("doesn't list finished, archived or copied trips", async () => {
    const owner = await Client.person("Owner");
    const viewer = await Client.person("Viewer");
    const past = await newTrip(owner, { ...PUBLIC, startDate: "2020-01-01", endDate: "2020-01-02" });
    expect(await inExplore(viewer, past.id)).toBe(false);
    expect((await viewer.req("GET", `/public/trips/${past.id}`)).status).toBe(404);

    const trip = await newTrip(owner, PUBLIC);
    const copyId = id("trip");
    expect((await owner.req("POST", `/trips/${trip.id}/copy`, { id: copyId, name: "Copied Trek", startDate: "2032-01-01" })).status).toBeLessThan(300);
    expect((await load(owner, copyId)).visibility).toBe("private");

    expect((await owner.req("PATCH", `/trips/${trip.id}`, { archived: true })).status).toBeLessThan(300);
    expect(await inExplore(viewer, trip.id)).toBe(false);
  });
});

describe("what a public trip reveals", () => {
  it("contains nothing private, whoever is looking", async () => {
    const owner = await Client.person("Leaky");
    const member = await Client.person("SecretMember");
    const secret = `SECRET${tag}`;
    const trip = await newTrip(owner, { ...PUBLIC, description: "Open to all", budget: 900000, perPersonBudget: 45000 });
    await member.req("POST", `/invites/${trip.joinCode}/accept`);

    // Plants a marked secret everywhere private information can live.
    const placeId = id("place");
    await owner.req("PUT", `/trips/${trip.id}/places/${placeId}`, { name: `${secret} hotel`, type: "stay", address: `${secret} address`, note: `${secret} note`, lat: 1, lng: 2 });
    await owner.req("PUT", `/trips/${trip.id}/activities/${id("act")}`, { day: 1, type: "activity", title: "Reach base camp", start: "10:00", end: "12:00", location: `${secret} location`, description: `${secret} description`, notes: `${secret} notes`, cost: 5000, placeId });
    await owner.req("PUT", `/trips/${trip.id}/expenses/${id("exp")}`, { title: `${secret} expense`, amount: 100, category: "stay", paidBy: owner.id, date: "2031-03-10", splitType: "equal", shares: [{ memberId: owner.id, amount: 100 }] });
    await owner.req("PUT", `/trips/${trip.id}/messages/${id("msg")}`, { kind: "text", text: `${secret} chat` });
    await owner.req("PUT", `/trips/${trip.id}/documents/${id("doc")}`, { name: `${secret} document`, category: "identity", fileType: "PDF", size: "1 KB", uploadedAt: "2031-01-01", visibility: "shared" });
    await owner.req("PUT", `/trips/${trip.id}/tasks/${id("task")}`, { title: `${secret} task`, assignee: owner.id, due: "2031-03-01", priority: "low", status: "todo" });

    const signedIn = await Client.person("Curious");
    const responses = await Promise.all([signedIn.req("GET", `/public/trips/${trip.id}`), new Client().req("GET", `/public/trips/${trip.id}`), signedIn.req("GET", `/public/trips?destination=${tag}`)]);
    for (const res of responses) {
      const text = JSON.stringify(res.body);
      expect(res.status).toBe(200);
      expect(text).not.toContain(secret);
      expect(text).not.toContain(trip.joinCode);
      expect(text).not.toContain(owner.email);
      expect(text).not.toContain(member.email);
      expect(text).not.toContain(member.name);
      expect(text).not.toContain("45000");
      expect(text).not.toContain("900000");
    }
    const [seen] = responses;
    expect(seen.body.plan).toEqual([{ day: 1, title: "Reach base camp", type: "activity" }]);
    expect(seen.body.participantCount).toBe(2);
    expect(seen.body.budgetPerPerson).toBeNull();
  });

  it("shows the budget only if the host chooses, and the plan only if the host chooses", async () => {
    const owner = await Client.person("Owner");
    const viewer = await Client.person("Viewer");
    const trip = await newTrip(owner, { visibility: "public", perPersonBudget: 45000, currency: "INR", showBudget: true, showPlan: false });
    await owner.req("PUT", `/trips/${trip.id}/activities/${id("act")}`, { day: 0, title: "Hidden plan", start: "10:00", end: "11:00" });
    const seen = (await viewer.req("GET", `/public/trips/${trip.id}`)).body;
    expect(seen).toMatchObject({ budgetPerPerson: 45000, currency: "INR", plan: [] });
  });

  it("shows someone signed out only the host's first name and photo", async () => {
    const owner = await Client.person("Hosting");
    const trip = await newTrip(owner, PUBLIC);
    const seen = (await new Client().req("GET", `/public/trips/${trip.id}`)).body;
    expect(seen.host).toEqual({ name: "Hosting", avatar: "", username: null, id: null });
    expect(seen.viewer.state).toBe("signed_out");
  });

  it("needs an account to browse or ask to join", async () => {
    const owner = await Client.person("Owner");
    const trip = await newTrip(owner, PUBLIC);
    const anonymous = new Client();
    expect((await anonymous.req("GET", "/public/trips")).status).toBe(401);
    expect((await ask(anonymous, trip.id)).status).toBe(401);
    expect((await anonymous.req("GET", "/people/suggested")).status).toBe(401);
  });

  it("doesn't open up files: a member-only file stays closed", async () => {
    const owner = await Client.person("Owner");
    const viewer = await Client.person("Viewer");
    const trip = await newTrip(owner, PUBLIC);
    const form = new FormData();
    form.append("file", new Blob(["%PDF-1.4 ticket"], { type: "application/pdf" }), "ticket.pdf");
    form.append("visibility", "shared");
    form.append("tripId", trip.id);
    const up = (await (await fetch(`${BASE}/api/files`, { method: "POST", headers: { Cookie: owner.cookie }, body: form })).json()) as { url: string };
    expect((await fetch(`${BASE}${up.url}`, { headers: { Cookie: viewer.cookie } })).status).toBe(404);
    expect((await viewer.req("GET", `/trips/${trip.id}`)).status).toBeGreaterThanOrEqual(403);
  });
});

describe("filters", () => {
  it("narrows by each filter", async () => {
    const owner = await Client.person("Filter");
    const viewer = await Client.person("Browser");
    const trek = await newTrip(owner, { ...PUBLIC, startDate: "2031-06-10", endDate: "2031-06-12", perPersonBudget: 10000, showBudget: true, currency: "INR", maxParticipants: 1 });
    const beach = await newTrip(owner, { visibility: "public", category: "Beach", travelStyle: "Beaches", startDate: "2031-08-01", endDate: "2031-08-20", perPersonBudget: 90000, showBudget: true, currency: "INR" });
    const both = async (query: string) => [await inExplore(viewer, trek.id, query), await inExplore(viewer, beach.id, query)];
    expect(await both("")).toEqual([true, true]);
    expect(await both("&category=Beach")).toEqual([false, true]);
    expect(await both("&style=Mountains")).toEqual([true, false]);
    expect(await both("&month=2031-06")).toEqual([true, false]);
    expect(await both("&from=2031-07-01")).toEqual([false, true]);
    expect(await both("&to=2031-07-01")).toEqual([true, false]);
    expect(await both("&maxDays=5")).toEqual([true, false]);
    expect(await both("&minDays=10")).toEqual([false, true]);
    expect(await both("&budgetMax=20000&currency=INR")).toEqual([true, false]);
    expect(await both("&available=true")).toEqual([false, true]);
    expect((await viewer.req("GET", "/public/trips?month=June")).status).toBe(422);
  });

  it("counts participants, and pages through long lists", async () => {
    const owner = await Client.person("Paged");
    const viewer = await Client.person("Reader");
    const trip = await newTrip(owner, PUBLIC);
    const guest = await Client.person("Guest");
    await guest.req("POST", `/invites/${trip.joinCode}/accept`);
    expect(await inExplore(viewer, trip.id, "&minPeople=2")).toBe(true);
    expect(await inExplore(viewer, trip.id, "&minPeople=3")).toBe(false);
    expect(await inExplore(viewer, trip.id, "&maxPeople=1")).toBe(false);
    const page = (await viewer.req("GET", `/public/trips?offset=100000`)).status;
    expect(page).toBe(422);
  });
});

describe("requesting to join", () => {
  it("adds nobody until the host accepts, and tells both people", async () => {
    const host = await Client.person("Host");
    const asker = await Client.person("Asker");
    const trip = await newTrip(host, PUBLIC);
    expect(await stateOf(asker, trip.id)).toBe("none");
    expect((await ask(asker, trip.id, "Love this route")).status).toBeLessThan(300);
    expect(await stateOf(asker, trip.id)).toBe("pending");
    expect((await asker.req("GET", `/trips/${trip.id}`)).status).toBeGreaterThanOrEqual(403);
    expect((await load(host, trip.id)).members).toHaveLength(1);
    expect((await host.req("GET", "/notifications")).body.map((n: { kind: string }) => n.kind)).toContain("join_request");

    const list = (await host.req("GET", `/trips/${trip.id}/join-requests`)).body;
    expect(list.pending[0]).toMatchObject({ message: "Love this route", person: { id: asker.id } });
    expect(JSON.stringify(list)).not.toContain(asker.email);

    expect((await host.req("POST", `/trips/${trip.id}/join-requests/${list.pending[0].id}/accept`)).status).toBe(200);
    expect(await stateOf(asker, trip.id)).toBe("member");
    expect((await asker.req("GET", `/trips/${trip.id}`)).status).toBe(200);
    expect((await load(asker, trip.id)).joinCode).toBeUndefined();
    expect((await asker.req("GET", "/state")).body.trips.map((t: { id: string }) => t.id)).toContain(trip.id);
    expect((await asker.req("GET", "/notifications")).body.map((n: { kind: string }) => n.kind)).toContain("join_accepted");
  });

  it("can't repeat, can be cancelled, and a rejection stands", async () => {
    const host = await Client.person("Host");
    const asker = await Client.person("Asker");
    const trip = await newTrip(host, PUBLIC);
    expect((await ask(asker, trip.id)).status).toBeLessThan(300);
    expect((await ask(asker, trip.id)).status).toBe(409);
    expect((await asker.req("DELETE", `/public/trips/${trip.id}/join-request`)).status).toBe(200);
    expect(await stateOf(asker, trip.id)).toBe("none");
    expect((await ask(asker, trip.id)).status).toBeLessThan(300);
    const requestId = await pendingId(host, trip.id, asker);
    expect((await host.req("POST", `/trips/${trip.id}/join-requests/${requestId}/reject`)).status).toBe(200);
    expect(await stateOf(asker, trip.id)).toBe("rejected");
    expect((await ask(asker, trip.id)).status).toBe(409);
    expect((await host.req("POST", `/trips/${trip.id}/join-requests/${requestId}/accept`)).status).toBe(404);
    expect((await asker.req("GET", "/notifications")).body.map((n: { kind: string }) => n.kind)).toContain("join_rejected");
  });

  it("is only for the right people", async () => {
    const host = await Client.person("Host");
    const trip = await newTrip(host, PUBLIC);
    expect((await ask(host, trip.id)).status).toBe(409);

    const unconfirmed = await Client.person("Unconfirmed", { verified: false });
    expect((await ask(unconfirmed, trip.id)).status).toBe(403);

    const member = await Client.person("Member");
    await member.req("POST", `/invites/${trip.joinCode}/accept`);
    expect((await ask(member, trip.id)).status).toBe(409);
    expect((await member.req("GET", `/trips/${trip.id}/join-requests`)).status).toBe(403);
    const stranger = await Client.person("Stranger");
    expect((await stranger.req("GET", `/trips/${trip.id}/join-requests`)).status).toBeGreaterThanOrEqual(403);

    const removed = await Client.person("Removed");
    await removed.req("POST", `/invites/${trip.joinCode}/accept`);
    await host.req("DELETE", `/trips/${trip.id}/members/${removed.id}`);
    expect((await ask(removed, trip.id)).status).toBe(403);

    const asker = await Client.person("Asker");
    await ask(asker, trip.id);
    const requestId = await pendingId(host, trip.id, asker);
    expect((await member.req("POST", `/trips/${trip.id}/join-requests/${requestId}/accept`)).status).toBe(403);
    expect((await asker.req("POST", `/trips/${trip.id}/join-requests/${requestId}/accept`)).status).toBeGreaterThanOrEqual(403);
  });

  it("lets an admin decide, as well as the owner", async () => {
    const host = await Client.person("Host");
    const admin = await Client.person("Admin");
    const trip = await newTrip(host, PUBLIC);
    await admin.req("POST", `/invites/${trip.joinCode}/accept`);
    await host.req("PATCH", `/trips/${trip.id}/members/${admin.id}`, { role: "admin" });
    const asker = await Client.person("Asker");
    await ask(asker, trip.id);
    const requestId = await pendingId(admin, trip.id, asker);
    expect((await admin.req("POST", `/trips/${trip.id}/join-requests/${requestId}/accept`)).status).toBe(200);
  });
});

describe("capacity and join requests", () => {
  it("refuses a request when full, and tells the host if the last place went before they accepted", async () => {
    const host = await Client.person("Host");
    const trip = await newTrip(host, { ...PUBLIC, maxParticipants: 2 });
    const a = await Client.person("Aaa");
    const b = await Client.person("Bbb");
    await ask(a, trip.id);
    await ask(b, trip.id);
    const first = await pendingId(host, trip.id, a);
    const second = await pendingId(host, trip.id, b);
    expect((await host.req("POST", `/trips/${trip.id}/join-requests/${first}/accept`)).status).toBe(200);
    const refused = await host.req("POST", `/trips/${trip.id}/join-requests/${second}/accept`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("TRIP_FULL");
    expect(await stateOf(b, trip.id)).toBe("pending");

    const c = await Client.person("Ccc");
    const full = await c.req("GET", `/public/trips/${trip.id}`);
    expect(full.body).toMatchObject({ full: true, placesLeft: 0, participantCount: 2, maxParticipants: 2 });
    expect((await ask(c, trip.id)).status).toBe(409);

    const current = await load(host, trip.id);
    expect((await host.req("PATCH", `/trips/${trip.id}`, { maxParticipants: 3, version: current.version })).status).toBeLessThan(300);
    expect((await host.req("POST", `/trips/${trip.id}/join-requests/${second}/accept`)).status).toBe(200);
  });

  it("can't overfill when two hosts accept at once", async () => {
    const host = await Client.person("Host");
    const trip = await newTrip(host, { ...PUBLIC, maxParticipants: 2 });
    const people = await Promise.all([Client.person("One"), Client.person("Two"), Client.person("Three")]);
    for (const p of people) await ask(p, trip.id);
    const ids = await Promise.all(people.map((p) => pendingId(host, trip.id, p)));
    const results = await Promise.all(ids.map((rid) => host.req("POST", `/trips/${trip.id}/join-requests/${rid}/accept`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await load(host, trip.id)).members.filter((m: { status: string }) => m.status === "active")).toHaveLength(2);
  }, 20_000);
});

describe("safety", () => {
  it("hides trips between people who've blocked each other, and ends waiting requests", async () => {
    const host = await Client.person("Host");
    const asker = await Client.person("Asker");
    const trip = await newTrip(host, PUBLIC);
    await ask(asker, trip.id);
    expect((await host.req("POST", "/blocks", { userId: asker.id })).status).toBe(200);
    expect((await asker.req("GET", `/public/trips/${trip.id}`)).status).toBe(404);
    expect(await inExplore(asker, trip.id)).toBe(false);
    expect((await ask(asker, trip.id)).status).toBe(404);
    expect((await host.req("GET", `/trips/${trip.id}/join-requests`)).body.pending).toEqual([]);
  });

  it("hides a suspended host's trips, and a report can take a trip down", async () => {
    const admin = await Client.person("Moderator", { email: ADMIN_EMAIL });
    const host = await Client.person("Host");
    const viewer = await Client.person("Viewer");
    const trip = await newTrip(host, PUBLIC);
    const details = `Looks like a scam ${tag}`;
    expect((await viewer.req("POST", "/reports", { targetType: "trip", targetId: trip.id, reason: "fake", details })).status).toBeLessThan(300);
    const row = (await admin.req("GET", "/admin/reports")).body.find((r: { details: string }) => r.details === details);
    expect(row).toMatchObject({ targetType: "trip", reason: "fake", target: { id: trip.id } });

    expect((await viewer.req("POST", `/admin/trips/${trip.id}/unpublish`)).status).toBe(404);
    expect((await admin.req("POST", `/admin/trips/${trip.id}/unpublish`)).status).toBe(200);
    expect(await inExplore(viewer, trip.id)).toBe(false);
    expect((await load(host, trip.id)).visibility).toBe("private");

    const second = await newTrip(host, PUBLIC);
    expect(await inExplore(viewer, second.id)).toBe(true);
    expect((await admin.req("POST", `/admin/users/${host.id}/suspend`)).status).toBe(200);
    expect(await inExplore(viewer, second.id)).toBe(false);
    expect((await viewer.req("GET", `/public/trips/${second.id}`)).status).toBe(404);
    await admin.req("POST", `/admin/users/${host.id}/unsuspend`);
  });

  it("can't report a private trip you can't see", async () => {
    const owner = await Client.person("Owner");
    const viewer = await Client.person("Viewer");
    const trip = await newTrip(owner);
    expect((await viewer.req("POST", "/reports", { targetType: "trip", targetId: trip.id, reason: "fake" })).status).toBe(404);
  });

  it("when a host deletes their account, a public trip goes private rather than passing on in public", async () => {
    const host = await Client.person("Leaving");
    const member = await Client.person("Staying");
    const viewer = await Client.person("Viewer");
    const trip = await newTrip(host, PUBLIC);
    await member.req("POST", `/invites/${trip.joinCode}/accept`);
    const asker = await Client.person("Asker");
    await ask(asker, trip.id);
    expect((await host.req("POST", "/me/delete", { password: "correct-horse" })).status).toBe(200);
    expect(await inExplore(viewer, trip.id)).toBe(false);
    expect((await load(member, trip.id)).visibility).toBe("private");
  });
});

describe("finding travellers", () => {
  it("suggests public profiles with something in common, never private ones, friends or blocked people", async () => {
    const me = await Client.person("Me");
    await me.req("PATCH", "/me", { travelStyles: ["Trekking in " + tag] });
    const style = "Trekking in " + tag;
    const match = await Client.person("Match");
    await match.req("PATCH", "/me", { travelStyles: [style] });
    await match.req("PATCH", "/me/profile", { profileVisibility: "public" });
    const privateMatch = await Client.person("Hidden");
    await privateMatch.req("PATCH", "/me", { travelStyles: [style] });
    const nothingInCommon = await Client.person("Different");
    await nothingInCommon.req("PATCH", "/me/profile", { profileVisibility: "public" });
    const blocked = await Client.person("Blocked");
    await blocked.req("PATCH", "/me", { travelStyles: [style] });
    await blocked.req("PATCH", "/me/profile", { profileVisibility: "public" });
    await me.req("POST", "/blocks", { userId: blocked.id });

    const ids = async () => (await me.req("GET", "/people/suggested")).body.map((p: { id: string }) => p.id);
    const list = await ids();
    expect(list).toContain(match.id);
    expect(list).not.toContain(privateMatch.id);
    expect(list).not.toContain(nothingInCommon.id);
    expect(list).not.toContain(blocked.id);
    expect(list).not.toContain(me.id);

    await me.req("POST", "/friends/requests", { username: match.username });
    expect(await ids()).not.toContain(match.id);
  });
});

afterAll(() => db.$disconnect());
