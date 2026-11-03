// Runs against a live server (`pnpm run db:up`, `pnpm run dev`).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.API_URL ?? "http://localhost:4000";
const COVER = "https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3";
const tag = randomUUID().slice(0, 8);
const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 12)}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==", "base64");

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
  async photoFile(tripId: string) {
    const form = new FormData();
    form.append("file", new Blob([PNG], { type: "image/png" }), "photo.png");
    form.append("visibility", "shared");
    form.append("tripId", tripId);
    const res = await fetch(`${BASE}/api/files`, { method: "POST", headers: { Cookie: this.cookie }, body: form });
    return ((await res.json()) as { url: string }).url;
  }
  static async signUp(name: string) {
    const c = new Client();
    expect((await c.req("POST", "/auth/signup", { name: `${name} Tester`, email: `${name}-${tag}-${randomUUID().slice(0, 6)}@example.test`, password: "correct-horse" })).status).toBeLessThan(300);
    c.id = (await c.req("GET", "/state")).body.user.id;
    return c;
  }
}

describe("memories and shared locations", () => {
  let owner: Client;
  let member: Client;
  let viewer: Client;
  let tripId: string;
  let otherTrip: string;
  const load = async (c: Client = owner) => (await c.req("GET", `/trips/${tripId}`)).body;

  beforeAll(async () => {
    owner = await Client.signUp("owner");
    member = await Client.signUp("member");
    viewer = await Client.signUp("viewer");
    tripId = id("trip");
    otherTrip = id("trip");
    const trip = await owner.req("POST", "/trips", { id: tripId, name: "Dated", destination: "Goa", cover: COVER, startDate: "2030-03-01", endDate: "2030-03-04" });
    expect((await member.req("POST", `/invites/${trip.body.joinCode}/accept`)).status).toBeLessThan(300);
    expect((await viewer.req("POST", `/invites/${trip.body.joinCode}/accept`)).status).toBeLessThan(300);
    expect((await owner.req("PATCH", `/trips/${tripId}/members/${viewer.id}`, { role: "viewer" })).status).toBeLessThan(300);
    expect((await owner.req("POST", "/trips", { id: otherTrip, name: "Other", destination: "Pune", cover: COVER, startDate: "2030-03-01", endDate: "2030-03-04" })).status).toBe(201);
  });

  const newPhoto = async (c: Client, extra: Record<string, unknown> = {}) => {
    const photoId = id("ph");
    const res = await c.req("PUT", `/trips/${tripId}/photos/${photoId}`, { url: await c.photoFile(tripId), caption: "First", day: 1, album: "Uploads", kind: "photo", ...extra });
    return { photoId, res };
  };

  it("keeps a photo on the date it was added to, with its details", async () => {
    const placeId = id("pl");
    expect((await owner.req("PUT", `/trips/${tripId}/places/${placeId}`, { name: "Beach", type: "stay", address: "", note: "" })).status).toBeLessThan(300);
    const { photoId, res } = await newPhoto(owner, { day: 2, placeId });
    expect(res.status).toBeLessThan(300);
    const photo = (await load(member)).photos.find((p: { id: string }) => p.id === photoId);
    expect(photo).toMatchObject({ day: 2, caption: "First", placeId, highlight: false });
  });

  it("refuses a place or activity from another trip", async () => {
    const foreignPlace = id("pl");
    expect((await owner.req("PUT", `/trips/${otherTrip}/places/${foreignPlace}`, { name: "Elsewhere", type: "stay", address: "", note: "" })).status).toBeLessThan(300);
    expect((await newPhoto(owner, { placeId: foreignPlace })).res.status).toBe(422);
    expect((await newPhoto(owner, { activityId: "not-a-real-activity" })).res.status).toBe(422);
  });

  it("lets only the author or an admin change a photo", async () => {
    const { photoId } = await newPhoto(member);
    const put = (c: Client, change: Record<string, unknown>) => c.req("PUT", `/trips/${tripId}/photos/${photoId}`, { url: "/api/files/x", caption: "First", day: 1, album: "Uploads", kind: "photo", ...change });
    const current = () => load().then((t) => t.photos.find((p: { id: string }) => p.id === photoId));

    expect((await put(member, { caption: "Mine", highlight: true })).status).toBeLessThan(300);
    expect(await current()).toMatchObject({ caption: "Mine", highlight: true });

    const stranger = await Client.signUp("stranger");
    expect((await put(stranger, { caption: "Vandalised" })).status).toBe(403);
    expect((await put(viewer, { caption: "Vandalised" })).status).toBe(403);
    expect(await current()).toMatchObject({ caption: "Mine" });

    expect((await put(owner, { caption: "Moderated" })).status).toBeLessThan(300);
    expect(await current()).toMatchObject({ caption: "Moderated" });
  });

  it("keeps a shared saved place in the message, even after it's deleted", async () => {
    const placeId = id("pl");
    expect((await owner.req("PUT", `/trips/${tripId}/places/${placeId}`, { name: "Hotel Sea", type: "stay", address: "Beach Road", note: "", lat: 15.5, lng: 73.8 })).status).toBeLessThan(300);
    const messageId = id("msg");
    expect((await member.req("PUT", `/trips/${tripId}/messages/${messageId}`, { kind: "location", text: "", placeId })).status).toBeLessThan(300);
    expect((await owner.req("DELETE", `/trips/${tripId}/places/${placeId}`)).status).toBeLessThan(300);
    const message = (await load()).messages.find((m: { id: string }) => m.id === messageId);
    expect(message.place).toEqual({ name: "Hotel Sea", address: "Beach Road", lat: 15.5, lng: 73.8 });
  });

  it("uses the trip's own record of a saved place rather than what the browser says", async () => {
    const placeId = id("pl");
    expect((await owner.req("PUT", `/trips/${tripId}/places/${placeId}`, { name: "Real Name", type: "stay", address: "", note: "", lat: 1, lng: 2 })).status).toBeLessThan(300);
    const messageId = id("msg");
    expect((await member.req("PUT", `/trips/${tripId}/messages/${messageId}`, { kind: "location", text: "", placeId, place: { name: "Fake", address: "", lat: 50, lng: 50 } })).status).toBeLessThan(300);
    expect((await load()).messages.find((m: { id: string }) => m.id === messageId).place).toMatchObject({ name: "Real Name", lat: 1, lng: 2 });
  });

  it("shares a searched place without saving it, and refuses nonsense positions", async () => {
    const before = (await load()).places.length;
    const messageId = id("msg");
    expect((await member.req("PUT", `/trips/${tripId}/messages/${messageId}`, { kind: "location", text: "", place: { name: "Market", address: "Panaji", lat: 15.49, lng: 73.82 } })).status).toBeLessThan(300);
    const trip = await load();
    expect(trip.messages.find((m: { id: string }) => m.id === messageId).place.name).toBe("Market");
    expect(trip.places.length).toBe(before);
    expect((await member.req("PUT", `/trips/${tripId}/messages/${id("msg")}`, { kind: "location", text: "", place: { name: "Nowhere", address: "", lat: 500, lng: 0 } })).status).toBe(422);
    expect((await viewer.req("PUT", `/trips/${tripId}/messages/${id("msg")}`, { kind: "location", text: "", place: { name: "Nope", address: "", lat: 1, lng: 1 } })).status).toBe(403);
  });

  it("still shows older location messages that only have a place id", async () => {
    const messageId = id("msg");
    expect((await member.req("PUT", `/trips/${tripId}/messages/${messageId}`, { kind: "location", text: "", placeId: "no-such-place" })).status).toBeLessThan(300);
    const message = (await load()).messages.find((m: { id: string }) => m.id === messageId);
    expect(message.placeId).toBe("no-such-place");
    expect(message.place).toBeUndefined();
  });
});
