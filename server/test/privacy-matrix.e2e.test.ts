// The whole privacy picture in one place: who can reach what, across trips, files, chat, memories, profiles,
// posts and Explore. Each row is a person, each column something private, and every cell is checked.
// Runs against a live server (`pnpm run db:up`, `pnpm run dev`).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const BASE = process.env.API_URL ?? "http://localhost:4000";
const COVER = "https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3";
const tag = randomUUID().slice(0, 8);
const SECRET = `SECRET${tag}`;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }) });
let counter = 0;
const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 12)}`;

class Client {
  cookie = "";
  id = "";
  email = "";
  username = "";
  constructor(readonly label: string) {}
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
  async upload(visibility: string, tripId?: string) {
    const form = new FormData();
    const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#884422" } }).jpeg().toBuffer();
    form.append("file", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "x.jpg");
    form.append("visibility", visibility);
    if (tripId) form.append("tripId", tripId);
    const res = await fetch(`${BASE}/api/files`, { method: "POST", headers: { Cookie: this.cookie }, body: form });
    return ((await res.json()) as { url: string }).url;
  }
  async file(url: string) {
    return (await fetch(`${BASE}${url}`, { headers: this.cookie ? { Cookie: this.cookie } : {} })).status;
  }
  static async person(label: string) {
    const c = new Client(label);
    c.email = `${label.toLowerCase()}-${tag}-${++counter}@example.test`;
    expect((await c.req("POST", "/auth/signup", { name: `${label} ${tag}`, email: c.email, password: "correct-horse" })).status).toBeLessThan(300);
    c.id = (await c.req("GET", "/state")).body.user.id;
    await db.user.update({ where: { id: c.id }, data: { onboarded: true, emailVerifiedAt: new Date() } });
    c.username = (await c.req("GET", "/me/profile")).body.username;
    return c;
  }
}

let owner: Client;
let member: Client;
let friend: Client;
let stranger: Client;
let blocked: Client;
const anonymous = new Client("Anonymous");
const r: Record<string, string> = {};

beforeAll(async () => {
  [owner, member, friend, stranger, blocked] = await Promise.all(["Owner", "Member", "Friend", "Stranger", "Blocked"].map((n) => Client.person(n)));

  // A private trip full of private things.
  r.trip = id("trip");
  const trip = await owner.req("POST", "/trips", { id: r.trip, name: `${SECRET} trip`, destination: "Goa", description: SECRET, cover: COVER, startDate: "2031-01-01", endDate: "2031-01-04" });
  r.joinCode = trip.body.joinCode;
  await member.req("POST", `/invites/${r.joinCode}/accept`);
  r.sharedFile = await owner.upload("shared", r.trip);
  r.memberPrivateFile = await member.upload("private", r.trip);
  await member.req("PUT", `/trips/${r.trip}/documents/${id("doc")}`, { name: `${SECRET} passport`, category: "identity", fileType: "JPG", size: "1 KB", uploadedAt: "2031-01-01", visibility: "private", dataUrl: r.memberPrivateFile });
  r.memoryFile = await owner.upload("shared", r.trip);
  await owner.req("PUT", `/trips/${r.trip}/photos/${id("ph")}`, { url: r.memoryFile, caption: SECRET, day: 0, album: "Uploads", kind: "photo" });
  await owner.req("PUT", `/trips/${r.trip}/messages/${id("msg")}`, { kind: "text", text: `${SECRET} chat` });

  // The owner's friendship, block, profile and posts.
  await owner.req("POST", "/friends/requests", { username: friend.username });
  const incoming = (await friend.req("GET", "/friends/requests")).body.incoming[0];
  await friend.req("POST", `/friends/requests/${incoming.id}/accept`);
  await owner.req("PATCH", "/me/profile", { location: `${SECRET} town`, interests: [SECRET] });
  for (const audience of ["public", "friends", "only_me"]) {
    const postId = id("post");
    const photo = await owner.upload("post");
    await owner.req("POST", "/posts", { id: postId, caption: `${audience} post`, visibility: audience, photos: [photo] });
    r[`post_${audience}`] = postId;
    r[`photo_${audience}`] = photo;
  }
  await owner.req("POST", "/blocks", { userId: blocked.id });
});

/** One row per person: what they should get for each check. True means they can see it. */
const EXPECTED: Record<string, Record<string, boolean>> = {
  Owner: { trip: true, sharedFile: true, memberPrivateFile: false, memoryFile: true, profileDetails: true, publicPost: true, friendsPost: true, onlyMePost: true, inSearch: false },
  Member: { trip: true, sharedFile: true, memberPrivateFile: true, memoryFile: true, profileDetails: false, publicPost: true, friendsPost: false, onlyMePost: false, inSearch: true },
  Friend: { trip: false, sharedFile: false, memberPrivateFile: false, memoryFile: false, profileDetails: true, publicPost: true, friendsPost: true, onlyMePost: false, inSearch: true },
  Stranger: { trip: false, sharedFile: false, memberPrivateFile: false, memoryFile: false, profileDetails: false, publicPost: true, friendsPost: false, onlyMePost: false, inSearch: true },
  Blocked: { trip: false, sharedFile: false, memberPrivateFile: false, memoryFile: false, profileDetails: false, publicPost: false, friendsPost: false, onlyMePost: false, inSearch: false },
  Anonymous: { trip: false, sharedFile: false, memberPrivateFile: false, memoryFile: false, profileDetails: false, publicPost: false, friendsPost: false, onlyMePost: false, inSearch: false },
};

async function observe(c: Client) {
  const ok = (status: number) => status === 200;
  const profile = await c.req("GET", `/profiles/${owner.username}`);
  const search = await c.req("GET", `/people/search?q=${encodeURIComponent(owner.username)}`);
  return {
    trip: ok((await c.req("GET", `/trips/${r.trip}`)).status),
    sharedFile: ok(await c.file(r.sharedFile)),
    memberPrivateFile: ok(await c.file(r.memberPrivateFile)),
    memoryFile: ok(await c.file(r.memoryFile)),
    profileDetails: ok(profile.status) && profile.body.location === `${SECRET} town`,
    publicPost: ok((await c.req("GET", `/posts/${r.post_public}`)).status) && ok(await c.file(r.photo_public)),
    friendsPost: ok((await c.req("GET", `/posts/${r.post_friends}`)).status) && ok(await c.file(r.photo_friends)),
    onlyMePost: ok((await c.req("GET", `/posts/${r.post_only_me}`)).status) && ok(await c.file(r.photo_only_me)),
    inSearch: ok(search.status) && search.body.some((p: { id: string }) => p.id === owner.id),
  };
}

describe("the privacy matrix", () => {
  it.each(["Owner", "Member", "Friend", "Stranger", "Blocked", "Anonymous"])("%s sees exactly what they should, and nothing else", async (label) => {
    const who = { Owner: owner, Member: member, Friend: friend, Stranger: stranger, Blocked: blocked, Anonymous: anonymous }[label] as Client;
    expect(await observe(who)).toEqual(EXPECTED[label]);
  });
});

describe("nothing private leaks through the places anyone can reach", () => {
  it("search, profiles, Explore, the invite preview and suggestions never carry trip secrets or email addresses", async () => {
    const responses = [
      await stranger.req("GET", `/profiles/${owner.username}`),
      await stranger.req("GET", `/people/search?q=${owner.username}`),
      await stranger.req("GET", "/people/suggested"),
      await stranger.req("GET", "/public/trips"),
      await stranger.req("GET", "/feed"),
      await stranger.req("GET", `/profiles/${owner.username}/posts`),
      await new Client("x").req("GET", `/public/trips/${r.trip}`),
    ];
    for (const res of responses) {
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(owner.email);
      expect(text).not.toContain(member.email);
      expect(text).not.toContain(r.joinCode);
    }
  });

  it("someone who has the invite link only learns the trip's basics until they join", async () => {
    const preview = await new Client("x").req("GET", `/invites/${r.joinCode}`);
    expect(preview.status).toBe(200);
    const text = JSON.stringify(preview.body);
    expect(text).not.toContain(`${SECRET} chat`);
    expect(text).not.toContain(`${SECRET} passport`);
    expect(text).not.toContain(owner.email);
  });

  it("a private document stays with its owner, even from the trip's owner", async () => {
    const trip = (await owner.req("GET", `/trips/${r.trip}`)).body;
    expect(JSON.stringify(trip.documents)).not.toContain(`${SECRET} passport`);
    expect(JSON.stringify((await member.req("GET", `/trips/${r.trip}`)).body.documents)).toContain(`${SECRET} passport`);
  });

  it("chat, memories and live locations stay inside the trip", async () => {
    for (const c of [friend, stranger, blocked]) {
      expect((await c.req("GET", `/trips/${r.trip}/messages?before=${new Date().toISOString()}&beforeId=z`)).status).toBeGreaterThanOrEqual(403);
      expect((await c.req("GET", `/trips/${r.trip}/live-locations`)).status).toBeGreaterThanOrEqual(403);
      expect((await c.req("PUT", `/trips/${r.trip}/photos/${id("ph")}`, { url: r.memoryFile, caption: "x", day: 0, album: "Uploads", kind: "photo" })).status).toBeGreaterThanOrEqual(403);
    }
  });

  it("making the trip public shows only what was chosen, and still not the people on it", async () => {
    const current = (await owner.req("GET", `/trips/${r.trip}`)).body;
    expect((await owner.req("PATCH", `/trips/${r.trip}`, { visibility: "public", version: current.version })).status).toBeLessThan(300);
    const seen = await stranger.req("GET", `/public/trips/${r.trip}`);
    expect(seen.status).toBe(200);
    const text = JSON.stringify(seen.body);
    expect(text).not.toContain(`${SECRET} chat`);
    expect(text).not.toContain(`${SECRET} passport`);
    expect(text).not.toContain(member.email);
    expect(text).not.toContain(r.joinCode);
    expect(seen.body.participantCount).toBe(2);
    // Public doesn't mean anyone can come in.
    expect((await stranger.req("GET", `/trips/${r.trip}`)).status).toBeGreaterThanOrEqual(403);
    expect(await stranger.file(r.sharedFile)).toBe(404);
    expect((await blocked.req("GET", `/public/trips/${r.trip}`)).status).toBe(404);
  });
});

afterAll(() => db.$disconnect());
