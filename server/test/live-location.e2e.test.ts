// Runs against a live server (`pnpm run db:up`, `pnpm run dev`).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";

const BASE = process.env.API_URL ?? "http://localhost:4000";
const COVER = "https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3";
const tag = randomUUID().slice(0, 8);
const here = { lat: 18.92, lng: 72.83, accuracy: 20 };
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }) });

class Client {
  cookie = "";
  id = "";
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
  static async signUp(name: string) {
    const c = new Client();
    const email = `${name}-${tag}-${randomUUID().slice(0, 6)}@example.test`;
    expect((await c.req("POST", "/auth/signup", { name: `${name} Tester`, email, password: "correct-horse" })).status).toBeLessThan(300);
    c.id = (await c.req("GET", "/state")).body.user.id;
    return c;
  }
}

describe("live location", () => {
  let owner: Client;
  let member: Client;
  let outsider: Client;
  let tripId: string;

  beforeAll(async () => {
    owner = await Client.signUp("owner");
    member = await Client.signUp("member");
    outsider = await Client.signUp("outsider");
    tripId = `trip-${randomUUID().slice(0, 12)}`;
    const trip = await owner.req("POST", "/trips", { id: tripId, name: "Live Trip", destination: "Mumbai", cover: COVER, startDate: "2030-03-01", endDate: "2030-03-04" });
    expect(trip.status).toBe(201);
    expect((await member.req("POST", `/invites/${trip.body.joinCode}/accept`)).status).toBeLessThan(300);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  const start = (c: Client, hours: number = 1) => c.req("PUT", `/trips/${tripId}/live-locations/me`, { ...here, hours });
  const list = (c: Client) => c.req("GET", `/trips/${tripId}/live-locations`);

  it("shares nothing until someone chooses to", async () => {
    expect((await list(owner)).body).toEqual([]);
    expect((await member.req("GET", "/live-locations/mine")).body).toEqual([]);
  });

  it("is seen by trip members and nobody else", async () => {
    expect((await start(member)).status).toBe(200);
    const seen = (await list(owner)).body;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ userId: member.id, lat: here.lat, lng: here.lng });
    expect((await list(outsider)).status).toBe(403);
    expect((await start(outsider)).status).toBe(403);
    expect((await new Client().req("GET", `/trips/${tripId}/live-locations`)).status).toBe(401);
  });

  it("only allows short, fixed durations", async () => {
    expect((await start(member, 24)).status).toBe(422);
    const { expiresAt } = (await start(member, 8)).body;
    const hours = (new Date(expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(7.9);
    expect(hours).toBeLessThanOrEqual(8);
  });

  it("rejects impossible coordinates", async () => {
    expect((await member.req("PATCH", `/trips/${tripId}/live-locations/me`, { lat: 200, lng: 0 })).status).toBe(422);
  });

  it("keeps only the latest position, and an update can't extend the end time", async () => {
    const before = (await list(owner)).body[0];
    expect((await member.req("PATCH", `/trips/${tripId}/live-locations/me`, { lat: 19, lng: 73 })).status).toBe(200);
    const rows = await db.liveLocation.findMany({ where: { tripId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lat: 19, lng: 73 });
    expect(rows[0].expiresAt.toISOString()).toBe(before.expiresAt);
  });

  it("deletes the position when someone stops, leaving nothing behind", async () => {
    expect((await member.req("DELETE", `/trips/${tripId}/live-locations/me`)).status).toBe(200);
    expect(await db.liveLocation.count({ where: { tripId, userId: member.id } })).toBe(0);
    expect((await member.req("PATCH", `/trips/${tripId}/live-locations/me`, { lat: 19, lng: 73 })).status).toBe(404);
  });

  it("ends by itself: an expired position is deleted, and can't be updated", async () => {
    await start(member);
    await db.liveLocation.update({ where: { tripId_userId: { tripId, userId: member.id } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await member.req("PATCH", `/trips/${tripId}/live-locations/me`, { lat: 19, lng: 73 })).status).toBe(404);
    expect((await list(owner)).body).toEqual([]);
    expect(await db.liveLocation.count({ where: { tripId, userId: member.id } })).toBe(0);
  });

  it("stops if the privacy setting is turned off, and can't start again until it's back on", async () => {
    await start(member);
    const privacy = { profilePublic: true, showEmail: false, shareLocation: false };
    expect((await member.req("PATCH", "/me", { privacy })).status).toBe(200);
    expect(await db.liveLocation.count({ where: { tripId, userId: member.id } })).toBe(0);
    expect((await start(member)).status).toBe(403);
    await member.req("PATCH", "/me", { privacy: { ...privacy, shareLocation: true } });
    expect((await start(member)).status).toBe(200);
  });

  it("stops everywhere on request, as signing out does", async () => {
    expect((await member.req("GET", "/live-locations/mine")).body).toHaveLength(1);
    expect((await member.req("DELETE", "/live-locations/mine")).status).toBe(200);
    expect((await member.req("GET", "/live-locations/mine")).body).toEqual([]);
  });

  it("hides someone who is no longer an active member", async () => {
    await start(member);
    await db.tripMember.update({ where: { tripId_userId: { tripId, userId: member.id } }, data: { status: "removed" as never } }).catch(async () => {
      await db.tripMember.delete({ where: { tripId_userId: { tripId, userId: member.id } } });
    });
    expect((await list(owner)).body).toEqual([]);
    expect((await start(member)).status).toBe(403);
  });
});
