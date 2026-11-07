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


const newTrip = async (c: Client, extra: Record<string, unknown> = {}) => {
  const tripId = id("trip");
  expect((await c.req("POST", "/trips", { id: tripId, name: "Invite Trip", destination: "Goa", cover: COVER, startDate: "2031-01-01", endDate: "2031-01-03", ...extra })).status).toBeLessThan(300);
  return tripId;
};
const statusOn = async (tripId: string, userId: string) => (await db.tripMember.findUnique({ where: { tripId_userId: { tripId, userId } } }))?.status ?? null;

describe("inviting travellers by name or username", () => {
  it("invites someone found in search, and tells them in the app", async () => {
    const host = await Client.person("Host");
    const found = await Client.person("Found");
    const tripId = await newTrip(host);
    const results = (await host.req("GET", `/people/search?q=${encodeURIComponent((await found.me()).username)}`)).body;
    expect(results.map((r: { id: string }) => r.id)).toContain(found.id);
    expect(JSON.stringify(results)).not.toContain(found.email);
    expect((await host.req("POST", `/trips/${tripId}/members`, { userId: found.id })).status).toBeLessThan(300);
    expect(await statusOn(tripId, found.id)).toBe("invited");
    expect(await db.notification.count({ where: { userId: found.id, tripId, kind: "invite" } })).toBe(1);
    expect((await host.req("POST", `/trips/${tripId}/members`, { userId: found.id })).status).toBe(409);
  });

  it("invites a past co-traveller even if they can't be found in search", async () => {
    const host = await Client.person("Past");
    const mate = await Client.person("Mate");
    const first = await newTrip(host);
    const code = (await db.trip.findUniqueOrThrow({ where: { id: first } })).joinCode;
    expect((await mate.req("POST", `/invites/${code}/accept`)).status).toBeLessThan(300);
    await db.user.update({ where: { id: mate.id }, data: { onboarded: false } });
    const second = await newTrip(host, { members: [{ id: mate.id }] });
    expect(await statusOn(second, mate.id)).toBe("invited");
  });

  it("refuses strangers who can't be found, blocked people, and bad input", async () => {
    const host = await Client.person("Strict");
    const hidden = await Client.person("Hidden");
    await db.user.update({ where: { id: hidden.id }, data: { onboarded: false } });
    const blocker = await Client.person("Blocker");
    expect((await blocker.req("POST", "/blocks", { userId: host.id })).status).toBeLessThan(300);
    const tripId = await newTrip(host);
    expect((await host.req("POST", `/trips/${tripId}/members`, { userId: hidden.id })).status).toBe(404);
    expect((await host.req("POST", `/trips/${tripId}/members`, { userId: blocker.id })).status).toBe(404);
    expect((await host.req("POST", `/trips/${tripId}/members`, { userId: host.id })).status).toBe(404);
    expect((await host.req("POST", `/trips/${tripId}/members`, {})).status).toBe(422);
    const created = await newTrip(host, { members: [{ id: hidden.id }, { id: blocker.id }] });
    expect(await statusOn(created, hidden.id)).toBeNull();
    expect(await statusOn(created, blocker.id)).toBeNull();
  });

  it("lists people you've travelled with, but never strangers or blocked people", async () => {
    const me = await Client.person("Lister");
    const mate = await Client.person("Mate");
    const stranger = await Client.person("Stranger");
    const blocker = await Client.person("Blocker");
    const tripId = await newTrip(me);
    const code = (await db.trip.findUniqueOrThrow({ where: { id: tripId } })).joinCode;
    for (const c of [mate, blocker]) expect((await c.req("POST", `/invites/${code}/accept`)).status).toBeLessThan(300);
    expect((await blocker.req("POST", "/blocks", { userId: me.id })).status).toBeLessThan(300);
    const ids = ((await me.req("GET", "/people/co-travellers")).body as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(mate.id);
    expect(ids).not.toContain(stranger.id);
    expect(ids).not.toContain(blocker.id);
    expect(ids).not.toContain(me.id);
    expect(JSON.stringify((await me.req("GET", "/people/co-travellers")).body)).not.toContain(mate.email);
  });

  it("only lets people who can invite do it", async () => {
    const host = await Client.person("Owner");
    const member = await Client.person("Member");
    const other = await Client.person("Other");
    const tripId = await newTrip(host);
    const code = (await db.trip.findUniqueOrThrow({ where: { id: tripId } })).joinCode;
    await member.req("POST", `/invites/${code}/accept`);
    expect((await member.req("POST", `/trips/${tripId}/members`, { userId: other.id })).status).toBe(403);
    expect((await other.req("POST", `/trips/${tripId}/members`, { userId: member.id })).status).toBe(403);
  });
});

afterAll(async () => {
  await db.$disconnect();
});
