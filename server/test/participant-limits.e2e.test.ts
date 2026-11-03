// Runs against a live server (`pnpm run db:up`, `pnpm run dev`).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";

// These create several accounts per test, which takes a while when everything runs at once.
vi.setConfig({ testTimeout: 30_000 });

const BASE = process.env.API_URL ?? "http://localhost:4000";
const COVER = "https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3";
const tag = randomUUID().slice(0, 8);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }) });
let counter = 0;

class Client {
  cookie = "";
  id = "";
  email = "";
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
  static async person(name: string) {
    const c = new Client();
    c.email = `${name}-${tag}-${++counter}@example.test`;
    expect((await c.req("POST", "/auth/signup", { name: `${name} Tester`, email: c.email, password: "correct-horse" })).status).toBeLessThan(300);
    c.id = (await c.req("GET", "/state")).body.user.id;
    await db.user.update({ where: { id: c.id }, data: { emailVerifiedAt: new Date(), onboarded: true } });
    return c;
  }
}

async function newTrip(owner: Client, maxParticipants: number | null, extra: Record<string, unknown> = {}) {
  const id = `trip-${randomUUID().slice(0, 12)}`;
  const trip = await owner.req("POST", "/trips", { id, name: "Limited Trip", destination: "Goa", cover: COVER, startDate: "2030-03-01", endDate: "2030-03-04", maxParticipants, ...extra });
  expect(trip.status).toBe(201);
  return { id, joinCode: trip.body.joinCode as string };
}
const load = async (c: Client, id: string) => (await c.req("GET", `/trips/${id}`)).body;
const joined = (trip: { members: { status?: string }[] }) => trip.members.filter((m) => m.status === "active").length;
const join = (c: Client, code: string) => c.req("POST", `/invites/${code}/accept`);
const inviteNotification = async (c: Client, tripId: string) => (await c.req("GET", "/notifications")).body.find((n: { kind: string; tripId: string }) => n.kind === "invite" && n.tripId === tripId);

describe("participant limits", () => {
  it("is off by default, and trips stay private, exactly as before", async () => {
    const owner = await Client.person("owner");
    const { id, joinCode } = await newTrip(owner, null);
    const trip = await load(owner, id);
    expect(trip).toMatchObject({ maxParticipants: null, visibility: "private" });
    for (let i = 0; i < 4; i++) expect((await join(await Client.person("guest"), joinCode)).status).toBeLessThan(300);
    expect(joined(await load(owner, id))).toBe(5);
  });

  it("counts the host, so a limit of 3 means two more people", async () => {
    const owner = await Client.person("owner");
    const { id, joinCode } = await newTrip(owner, 3);
    const a = await Client.person("a");
    const b = await Client.person("b");
    const c = await Client.person("c");
    expect((await join(a, joinCode)).status).toBeLessThan(300);
    expect((await join(b, joinCode)).status).toBeLessThan(300);
    const refused = await join(c, joinCode);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("TRIP_FULL");
    expect(refused.body.message).toContain("full");
    expect(joined(await load(owner, id))).toBe(3);
    expect((await c.req("GET", `/trips/${id}`)).status).toBeGreaterThanOrEqual(403);
  });

  it("lets someone already on the trip repeat a click on a full trip", async () => {
    const owner = await Client.person("owner");
    const { joinCode } = await newTrip(owner, 2);
    const a = await Client.person("a");
    expect((await join(a, joinCode)).status).toBeLessThan(300);
    expect((await join(a, joinCode)).status).toBeLessThan(300);
    expect((await join(owner, joinCode)).status).toBeLessThan(300);
  });

  it("never lets simultaneous joins take the same last place", async () => {
    const owner = await Client.person("owner");
    const { id, joinCode } = await newTrip(owner, 3);
    const people = await Promise.all(Array.from({ length: 6 }, (_, i) => Client.person(`racer${i}`)));
    const results = await Promise.all(people.map((p) => join(p, joinCode)));
    expect(results.filter((r) => r.status < 300)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(joined(await load(owner, id))).toBe(3);
  }, 30_000);

  it("stops invitations being sent when full, and an accepted invitation can't overfill it", async () => {
    const owner = await Client.person("owner");
    const { id, joinCode } = await newTrip(owner, 2);
    const invited = await Client.person("invited");
    expect((await owner.req("POST", `/trips/${id}/members`, { email: invited.email })).status).toBeLessThan(300);
    const notification = await inviteNotification(invited, id);
    expect(notification).toBeDefined();

    // An invitation doesn't hold a place, so someone else can take it first.
    const quick = await Client.person("quick");
    expect((await join(quick, joinCode)).status).toBeLessThan(300);
    expect((await owner.req("POST", `/trips/${id}/members`, { email: `another-${tag}@example.test` })).status).toBe(409);

    const refused = await invited.req("POST", `/notifications/${notification.id}/accept`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("TRIP_FULL");
    expect(joined(await load(owner, id))).toBe(2);

    // The invitation survives, and works as soon as there's room.
    const current = await load(owner, id);
    expect((await owner.req("PATCH", `/trips/${id}`, { maxParticipants: 3, version: current.version })).status).toBeLessThan(300);
    expect((await invited.req("POST", `/notifications/${notification.id}/accept`)).status).toBeLessThan(300);
    expect(joined(await load(owner, id))).toBe(3);
  });

  it("frees a place when someone is removed", async () => {
    const owner = await Client.person("owner");
    const { id, joinCode } = await newTrip(owner, 2);
    const a = await Client.person("a");
    const b = await Client.person("b");
    expect((await join(a, joinCode)).status).toBeLessThan(300);
    expect((await join(b, joinCode)).status).toBe(409);
    expect((await owner.req("DELETE", `/trips/${id}/members/${a.id}`)).status).toBeLessThan(300);
    expect((await join(b, joinCode)).status).toBeLessThan(300);
    expect((await join(a, joinCode)).status).toBe(403);
  });

  it("can be raised, turned off, and set to exactly how many have joined, but never lower", async () => {
    const owner = await Client.person("owner");
    const { id, joinCode } = await newTrip(owner, null);
    for (let i = 0; i < 4; i++) expect((await join(await Client.person("g"), joinCode)).status).toBeLessThan(300);
    const patch = async (maxParticipants: number | null) => owner.req("PATCH", `/trips/${id}`, { maxParticipants, version: (await load(owner, id)).version });

    const tooLow = await patch(4);
    expect(tooLow.status).toBe(409);
    expect(tooLow.body.message).toContain("5 people");
    expect(joined(await load(owner, id))).toBe(5);

    expect((await patch(5)).status).toBeLessThan(300);
    expect((await join(await Client.person("late"), joinCode)).status).toBe(409);
    expect((await patch(6)).status).toBeLessThan(300);
    expect((await join(await Client.person("late"), joinCode)).status).toBeLessThan(300);
    expect((await join(await Client.person("later"), joinCode)).status).toBe(409);
    expect((await patch(null)).status).toBeLessThan(300);
    expect((await join(await Client.person("later"), joinCode)).status).toBeLessThan(300);
    expect((await load(owner, id)).maxParticipants).toBeNull();
  }, 30_000);

  it("refuses nonsense limits, and only the host and admins can change it", async () => {
    const owner = await Client.person("owner");
    const { id, joinCode } = await newTrip(owner, null);
    const member = await Client.person("member");
    await join(member, joinCode);
    for (const bad of [0, -1, 1.5, 100000, "6"]) expect((await owner.req("PATCH", `/trips/${id}`, { maxParticipants: bad })).status).toBe(422);
    expect((await member.req("PATCH", `/trips/${id}`, { maxParticipants: 9 })).status).toBe(403);
    const created = await owner.req("POST", "/trips", { id: `trip-${randomUUID().slice(0, 12)}`, name: "Bad Trip", destination: "Goa", cover: COVER, startDate: "2030-03-01", endDate: "2030-03-04", maxParticipants: 0 });
    expect(created.status).toBe(422);
  });

  it("tells the host when the last place goes, but not before", async () => {
    const owner = await Client.person("owner");
    const { joinCode } = await newTrip(owner, 3);
    const kinds = async () => (await owner.req("GET", "/notifications")).body.map((n: { kind: string }) => n.kind);
    await join(await Client.person("a"), joinCode);
    expect(await kinds()).not.toContain("trip_full");
    await join(await Client.person("b"), joinCode);
    expect(await kinds()).toContain("trip_full");
  });

  it("shows capacity on the invite page, to anyone with the link", async () => {
    const owner = await Client.person("owner");
    const { joinCode } = await newTrip(owner, 2);
    const preview = (await new Client().req("GET", `/invites/${joinCode}`)).body;
    expect(preview.maxParticipants).toBe(2);
    expect(preview.members).toHaveLength(1);
  });

  it("doesn't copy the limit or visibility to a new trip", async () => {
    const owner = await Client.person("owner");
    const { id } = await newTrip(owner, 2);
    const copyId = `trip-${randomUUID().slice(0, 12)}`;
    expect((await owner.req("POST", `/trips/${id}/copy`, { id: copyId, name: "Copied Trip", startDate: "2031-01-01" })).status).toBeLessThan(300);
    expect(await load(owner, copyId)).toMatchObject({ maxParticipants: null, visibility: "private" });
  });
});

afterAll(() => db.$disconnect());
