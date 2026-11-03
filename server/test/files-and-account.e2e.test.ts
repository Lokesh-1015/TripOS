// Runs against a live server (`pnpm run db:up`, `pnpm run dev`).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";

const BASE = process.env.API_URL ?? "http://localhost:4000";
const COVER = "https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3";
const tag = randomUUID().slice(0, 8);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }) });

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
  async upload(data: Uint8Array | string, type: string, visibility: string, tripId?: string, name = "file") {
    const form = new FormData();
    form.append("file", new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type }), name);
    form.append("visibility", visibility);
    if (tripId) form.append("tripId", tripId);
    const res = await fetch(`${BASE}/api/files`, { method: "POST", headers: { Cookie: this.cookie }, body: form });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }
  static async signUp(name: string) {
    const c = new Client();
    c.email = `${name}-${tag}-${randomUUID().slice(0, 6)}@example.test`;
    expect((await c.req("POST", "/auth/signup", { name: `${name} Tester`, email: c.email, password: "correct-horse" })).status).toBeLessThan(300);
    c.id = (await c.req("GET", "/state")).body.user.id;
    return c;
  }
}

const newTrip = async (owner: Client) => {
  const id = `trip-${randomUUID().slice(0, 12)}`;
  const trip = await owner.req("POST", "/trips", { id, name: "Safety Trip", destination: "Goa", cover: COVER, startDate: "2030-03-01", endDate: "2030-03-04" });
  expect(trip.status).toBe(201);
  return { id, joinCode: trip.body.joinCode as string };
};

const photoWithGps = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: "#cc5500" } })
    .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "15/1 29/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "73/1 49/1 0/1" } })
    .jpeg()
    .toBuffer();

describe("uploads", () => {
  let owner: Client;
  let tripId: string;

  beforeAll(async () => {
    owner = await Client.signUp("owner");
    ({ id: tripId } = await newTrip(owner));
  });

  it("removes the GPS position from a photo", async () => {
    const original = await photoWithGps();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const uploaded = await owner.upload(original, "image/jpeg", "shared", tripId, "beach.jpg");
    expect(uploaded.status).toBe(201);
    const res = await fetch(`${BASE}${uploaded.body.url}`, { headers: { Cookie: owner.cookie } });
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const stored = Buffer.from(await res.arrayBuffer());
    const metadata = await sharp(stored).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.width).toBe(64);
    expect(stored.includes("GPS")).toBe(false);
  });

  it("refuses something pretending to be an image", async () => {
    expect((await owner.upload("<script>alert(1)</script>", "image/png", "shared", tripId, "x.png")).status).toBe(422);
    expect((await owner.upload("<script>alert(1)</script>", "image/png", "public", undefined, "x.png")).status).toBe(422);
    expect((await owner.upload("<html></html>", "application/pdf", "shared", tripId, "x.pdf")).status).toBe(422);
  });

  it("goes by what a file really is, not what the browser claimed", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#00ff00" } }).png().toBuffer();
    const uploaded = await owner.upload(png, "image/jpeg", "shared", tripId, "really-a-png.jpg");
    expect(uploaded.status).toBe(201);
    const res = await fetch(`${BASE}${uploaded.body.url}`, { headers: { Cookie: owner.cookie } });
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("still takes other documents, as downloads", async () => {
    const uploaded = await owner.upload("Flight notes", "text/plain", "shared", tripId, "notes.txt");
    expect(uploaded.status).toBe(201);
    const res = await fetch(`${BASE}${uploaded.body.url}`, { headers: { Cookie: owner.cookie } });
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(await res.text()).toBe("Flight notes");
  });

  it("stops at the per-person storage limit", async () => {
    const person = await Client.signUp("hoarder");
    await db.storedFile.create({ data: { uploadedBy: person.id, fileName: "big", mimeType: "application/pdf", sizeBytes: 500 * 1024 * 1024, isPublic: false } });
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#00ff00" } }).png().toBuffer();
    const res = await person.upload(png, "image/png", "public");
    expect(res.status).toBe(422);
    expect(res.body.message).toContain("storage");
  });
});

describe("terms", () => {
  it("records them at signup, and asks older accounts once", async () => {
    const person = await Client.signUp("terms");
    expect((await person.req("GET", "/state")).body.termsAccepted).toBe(true);
    await db.user.update({ where: { id: person.id }, data: { termsAcceptedAt: null } });
    expect((await person.req("GET", "/state")).body.termsAccepted).toBe(false);
    expect((await person.req("POST", "/me/accept-terms")).status).toBe(200);
    expect((await person.req("GET", "/state")).body.termsAccepted).toBe(true);
  });
});

describe("contact form", () => {
  it("emails whoever runs TripOS", async () => {
    const subject = `Sender ${tag}`;
    const anonymous = new Client();
    expect((await anonymous.req("POST", "/contact", { name: subject, email: "someone@example.test", message: "<b>Hello</b> there" })).status).toBe(200);
    expect((await anonymous.req("POST", "/contact", { name: "x", email: "not-an-address", message: "Hello there" })).status).toBe(422);
    const mail = await (await fetch(`http://localhost:8025/api/v1/search?query=${encodeURIComponent(subject)}`)).json();
    expect(mail.messages.length).toBeGreaterThan(0);
  });
});

describe("deleting an account", () => {
  it("needs the password, and leaves everything alone if it's wrong", async () => {
    const person = await Client.signUp("wrongpw");
    expect((await person.req("POST", "/me/delete", { password: "not-it" })).status).toBe(401);
    expect((await person.req("POST", "/me/delete", {})).status).toBe(401);
    expect((await person.req("GET", "/state")).status).toBe(200);
  });

  it("removes what identifies someone but keeps the group's records", async () => {
    const owner = await Client.signUp("leaver");
    const friend = await Client.signUp("friend");
    const stranger = await Client.signUp("stranger");
    const shared = await newTrip(owner);
    const alone = await newTrip(owner);
    expect((await friend.req("POST", `/invites/${shared.joinCode}/accept`)).status).toBeLessThan(300);
    expect((await stranger.req("POST", `/invites/${shared.joinCode}/accept`)).status).toBeLessThan(300);
    expect((await owner.req("PATCH", `/trips/${shared.id}/members/${stranger.id}`, { role: "viewer" })).status).toBeLessThan(300);

    const expenseId = `exp-${randomUUID().slice(0, 12)}`;
    expect((await owner.req("PUT", `/trips/${shared.id}/expenses/${expenseId}`, { title: "Taxi", amount: 300, category: "transport", paidBy: owner.id, date: "2030-03-01", splitType: "equal", shares: [{ memberId: owner.id, amount: 150 }, { memberId: friend.id, amount: 150 }] })).status).toBeLessThan(300);
    const messageId = `msg-${randomUUID().slice(0, 12)}`;
    expect((await owner.req("PUT", `/trips/${shared.id}/messages/${messageId}`, { kind: "text", text: "On my way" })).status).toBeLessThan(300);

    const passport = await owner.upload("%PDF-1.4 passport", "application/pdf", "private", shared.id, "passport.pdf");
    expect(passport.status).toBe(201);
    const documentId = `doc-${randomUUID().slice(0, 12)}`;
    expect((await owner.req("PUT", `/trips/${shared.id}/documents/${documentId}`, { name: "Passport", category: "identity", fileType: "PDF", size: "1 KB", uploadedAt: "2030-01-01", visibility: "private", dataUrl: passport.body.url })).status).toBeLessThan(300);
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#00ff00" } }).png().toBuffer();
    const avatar = await owner.upload(png, "image/png", "public");
    expect((await owner.req("PATCH", "/me", { avatar: avatar.body.url })).status).toBe(200);

    const before = (await friend.req("GET", `/trips/${shared.id}`)).body;
    const oldCookie = owner.cookie;
    expect((await owner.req("POST", "/me/delete", { password: "correct-horse" })).status).toBe(200);

    // The old session is gone, and so is the way back in.
    owner.cookie = oldCookie;
    expect((await owner.req("GET", "/state")).status).toBe(401);
    expect((await new Client().req("POST", "/auth/login", { email: owner.email, password: "correct-horse" })).status).toBe(401);

    const row = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(row.email).toContain("@deleted.invalid");
    expect(row.name).toBe("Former member");
    expect(row.passwordHash).toBeNull();
    expect(row.deletedAt).not.toBeNull();
    expect(await db.session.count({ where: { userId: owner.id } })).toBe(0);

    // Their private document and photo are gone. The trip only they were on is gone.
    expect(await db.tripDocument.count({ where: { id: documentId } })).toBe(0);
    expect((await fetch(`${BASE}${passport.body.url}`, { headers: { Cookie: friend.cookie } })).status).toBe(404);
    expect((await fetch(`${BASE}${avatar.body.url}`)).status).toBe(404);
    expect(await db.trip.count({ where: { id: alone.id } })).toBe(0);

    // The group keeps its trip and its records. Ownership goes to a full member, not the viewer.
    const after = (await friend.req("GET", `/trips/${shared.id}`)).body;
    expect(after.members.find((m: { id: string }) => m.id === friend.id).role).toBe("owner");
    const gone = after.members.find((m: { id: string }) => m.id === owner.id);
    expect(gone === undefined || (gone.name === "Former member" && gone.email === "")).toBe(true);
    expect(after.expenses.map((e: { id: string }) => e.id)).toEqual(before.expenses.map((e: { id: string }) => e.id));
    expect(after.messages.some((m: { id: string }) => m.id === messageId)).toBe(true);

    // The same address can sign up fresh, as a different account.
    const again = new Client();
    expect((await again.req("POST", "/auth/signup", { name: "Back Again", email: owner.email, password: "correct-horse" })).status).toBeLessThan(300);
    expect((await again.req("GET", "/state")).body.user.id).not.toBe(owner.id);
    expect((await again.req("GET", "/state")).body.trips).toEqual([]);
  }, 30_000);

  it("confirms by typing the email when there's no password", async () => {
    const person = await Client.signUp("googleonly");
    await db.user.update({ where: { id: person.id }, data: { passwordHash: null, googleSub: `sub-${randomUUID()}` } });
    expect((await person.req("POST", "/me/delete", { email: "someone-else@example.test" })).status).toBe(422);
    expect((await person.req("POST", "/me/delete", { email: person.email.toUpperCase() })).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: person.id } })).googleSub).toBeNull();
  });
});

afterAll(() => db.$disconnect());
