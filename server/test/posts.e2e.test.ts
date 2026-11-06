// Runs against a live server (`pnpm run db:up`, `pnpm run dev`) with ADMIN_EMAILS including the address below.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
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
  async upload(visibility: string, tripId?: string, withGps = false) {
    let image = sharp({ create: { width: 40, height: 30, channels: 3, background: "#3366aa" } });
    if (withGps) image = image.withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "15/1 29/1 0/1" } });
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(await image.jpeg().toBuffer())], { type: "image/jpeg" }), "photo.jpg");
    form.append("visibility", visibility);
    if (tripId) form.append("tripId", tripId);
    const res = await fetch(`${BASE}/api/files`, { method: "POST", headers: { Cookie: this.cookie }, body: form });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }
  file(url: string) {
    return fetch(`${BASE}${url}`, { headers: this.cookie ? { Cookie: this.cookie } : {} });
  }
  static async person(name: string, options: { email?: string; verified?: boolean } = {}) {
    const c = new Client();
    c.email = options.email ?? `${name.toLowerCase()}-${tag}-${++counter}@example.test`;
    const signUp = await c.req("POST", "/auth/signup", { name: `${name} ${tag}`, email: c.email, password: "correct-horse" });
    if (signUp.status === 409) expect((await c.req("POST", "/auth/login", { email: c.email, password: "correct-horse" })).status).toBe(200);
    c.id = (await c.req("GET", "/state")).body.user.id;
    await db.user.update({ where: { id: c.id }, data: { onboarded: true, emailVerifiedAt: options.verified === false ? null : new Date() } });
    c.username = (await c.req("GET", "/me/profile")).body.username;
    return c;
  }
}

const friends = async (a: Client, b: Client) => {
  expect((await a.req("POST", "/friends/requests", { username: b.username })).status).toBeLessThan(300);
  const incoming = (await b.req("GET", "/friends/requests")).body.incoming.find((r: { person: { id: string } }) => r.person.id === a.id);
  expect((await b.req("POST", `/friends/requests/${incoming.id}/accept`)).status).toBe(200);
};
async function post(author: Client, visibility: string, extra: Record<string, unknown> = {}) {
  const photo = await author.upload("post");
  expect(photo.status).toBe(201);
  const postId = id("post");
  const res = await author.req("POST", "/posts", { id: postId, caption: `Caption ${tag}`, destination: "Hampi", visibility, photos: [photo.body.url], ...extra });
  expect(res.status).toBeLessThan(300);
  return { id: postId, photo: res.body.photos[0] as string };
}
const canSee = async (viewer: Client, p: { id: string; photo: string }) => {
  const [single, photo, comments] = await Promise.all([viewer.req("GET", `/posts/${p.id}`), viewer.file(p.photo), viewer.req("GET", `/posts/${p.id}/comments`)]);
  const inFeed = (await viewer.req("GET", "/feed")).body?.posts?.some((x: { id: string }) => x.id === p.id) ?? false;
  return { single: single.status, photo: photo.status, comments: comments.status, inFeed };
};

describe("who can see a post", () => {
  it("follows each post's audience, everywhere: the post, its photo, its comments and the feed", async () => {
    const author = await Client.person("Author");
    const friend = await Client.person("Friend");
    const stranger = await Client.person("Stranger");
    await friends(author, friend);
    const everyone = await post(author, "public");
    const friendsOnly = await post(author, "friends");
    const onlyMe = await post(author, "only_me");

    const yes = { single: 200, photo: 200, comments: 200, inFeed: true };
    const no = { single: 404, photo: 404, comments: 404, inFeed: false };
    expect(await canSee(author, everyone)).toEqual(yes);
    expect(await canSee(author, friendsOnly)).toEqual(yes);
    expect(await canSee(author, onlyMe)).toEqual(yes);
    expect(await canSee(friend, everyone)).toEqual(yes);
    expect(await canSee(friend, friendsOnly)).toEqual(yes);
    expect(await canSee(friend, onlyMe)).toEqual(no);
    expect(await canSee(stranger, everyone)).toEqual(yes);
    expect(await canSee(stranger, friendsOnly)).toEqual(no);
    expect(await canSee(stranger, onlyMe)).toEqual(no);

    const anonymous = new Client();
    expect((await anonymous.req("GET", `/posts/${everyone.id}`)).status).toBe(401);
    expect((await anonymous.file(everyone.photo)).status).toBe(401);
    expect((await anonymous.req("GET", "/feed")).status).toBe(401);
  });

  it("changes straight away when the audience or the friendship changes", async () => {
    const author = await Client.person("Author");
    const friend = await Client.person("Friend");
    await friends(author, friend);
    const p = await post(author, "friends");
    expect((await canSee(friend, p)).single).toBe(200);
    expect((await author.req("PATCH", `/posts/${p.id}`, { visibility: "only_me" })).status).toBe(200);
    expect((await canSee(friend, p)).photo).toBe(404);
    expect((await author.req("PATCH", `/posts/${p.id}`, { visibility: "friends" })).status).toBe(200);
    expect((await canSee(friend, p)).photo).toBe(200);
    await friend.req("DELETE", `/friends/${author.id}`);
    expect(await canSee(friend, p)).toEqual({ single: 404, photo: 404, comments: 404, inFeed: false });
  });

  it("hides everything between people who've blocked each other, and from suspended or deleted authors", async () => {
    const admin = await Client.person("Moderator", { email: ADMIN_EMAIL });
    const author = await Client.person("Author");
    const viewer = await Client.person("Viewer");
    const p = await post(author, "public");
    await viewer.req("POST", "/blocks", { userId: author.id });
    expect((await canSee(viewer, p)).single).toBe(404);
    expect((await canSee(author, p)).single).toBe(200);
    await viewer.req("DELETE", `/blocks/${author.id}`);
    expect((await canSee(viewer, p)).single).toBe(200);

    await admin.req("POST", `/admin/users/${author.id}/suspend`);
    expect((await canSee(viewer, p)).single).toBe(404);
    await admin.req("POST", `/admin/users/${author.id}/unsuspend`);
    expect((await new Client().req("POST", "/auth/login", { email: author.email, password: "correct-horse" })).status).toBe(200);
  });

  it("shows profiles' posts by the same rule, even on a private profile", async () => {
    const author = await Client.person("Author");
    const viewer = await Client.person("Viewer");
    const everyone = await post(author, "public");
    const friendsOnly = await post(author, "friends");
    const ids = (await viewer.req("GET", `/profiles/${author.username}/posts`)).body.posts.map((p: { id: string }) => p.id);
    expect(ids).toContain(everyone.id);
    expect(ids).not.toContain(friendsOnly.id);
    expect((await author.req("GET", `/profiles/${author.username}/posts`)).body.posts).toHaveLength(2);
  });

  it("names a linked trip only for people who could see that trip anyway", async () => {
    const author = await Client.person("Author");
    const viewer = await Client.person("Viewer");
    const tripId = id("trip");
    expect((await author.req("POST", "/trips", { id: tripId, name: `Secret Trip ${tag}`, destination: "Goa", cover: COVER, startDate: "2031-01-01", endDate: "2031-01-03" })).status).toBe(201);
    const p = await post(author, "public", { tripId });
    const seen = await viewer.req("GET", `/posts/${p.id}`);
    expect(seen.body.trip).toBeNull();
    expect(JSON.stringify(seen.body)).not.toContain("Secret Trip");
    expect((await author.req("GET", `/posts/${p.id}`)).body.trip).toMatchObject({ id: tripId, isMember: true });
    expect(seen.body.visibility).toBeUndefined();
    expect(JSON.stringify(seen.body)).not.toContain(author.email);
  });
});

describe("making posts", () => {
  it("needs a photo, a confirmed email, and the author's own fresh uploads", async () => {
    const author = await Client.person("Author");
    const other = await Client.person("Other");
    expect((await author.req("POST", "/posts", { id: id("post"), caption: "No photo", visibility: "public", photos: [] })).status).toBe(422);
    const theirs = await other.upload("post");
    expect((await author.req("POST", "/posts", { id: id("post"), visibility: "public", photos: [theirs.body.url] })).status).toBe(422);
    const unconfirmed = await Client.person("Unconfirmed", { verified: false });
    const photo = await unconfirmed.upload("post");
    expect((await unconfirmed.req("POST", "/posts", { id: id("post"), visibility: "public", photos: [photo.body.url] })).status).toBe(403);
    expect((await author.req("POST", "/posts", { id: id("post"), visibility: "everyone", photos: [] })).status).toBe(422);
  });

  it("doesn't let a trip file or another post's photo be reused, which would change who sees it", async () => {
    const author = await Client.person("Author");
    const tripId = id("trip");
    expect((await author.req("POST", "/trips", { id: tripId, name: "Trip Files", destination: "Goa", cover: COVER, startDate: "2031-01-01", endDate: "2031-01-03" })).status).toBe(201);
    const tripFile = await author.upload("shared", tripId);
    expect((await author.req("POST", "/posts", { id: id("post"), visibility: "public", photos: [tripFile.body.url] })).status).toBe(422);
    const first = await post(author, "only_me");
    expect((await author.req("POST", "/posts", { id: id("post"), visibility: "public", photos: [first.photo] })).status).toBe(422);
  });

  it("keeps an unposted photo private to its uploader, and removes location data", async () => {
    const author = await Client.person("Author");
    const other = await Client.person("Other");
    const photo = await author.upload("post", undefined, true);
    expect((await other.file(photo.body.url)).status).toBe(404);
    const res = await author.file(photo.body.url);
    expect(res.status).toBe(200);
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).exif).toBeUndefined();
  });

  it("can only be edited by the author, and deleting takes its photos with it", async () => {
    const author = await Client.person("Author");
    const other = await Client.person("Other");
    const p = await post(author, "public");
    expect((await other.req("PATCH", `/posts/${p.id}`, { caption: "Hacked" })).status).toBe(404);
    expect((await other.req("DELETE", `/posts/${p.id}`)).status).toBe(404);
    expect((await author.req("PATCH", `/posts/${p.id}`, { caption: "Better caption" })).body).toMatchObject({ caption: "Better caption", edited: true });
    expect((await author.req("DELETE", `/posts/${p.id}`)).status).toBe(200);
    expect((await author.req("GET", `/posts/${p.id}`)).status).toBe(404);
    expect((await author.file(p.photo)).status).toBe(404);
  });
});

describe("likes and comments", () => {
  it("only for people who can see the post, with one notification per post rather than one per like", async () => {
    const author = await Client.person("Author");
    const friend = await Client.person("Friend");
    const stranger = await Client.person("Stranger");
    const another = await Client.person("Another");
    await friends(author, friend);
    const p = await post(author, "friends");
    expect((await stranger.req("PUT", `/posts/${p.id}/like`)).status).toBe(404);
    expect((await stranger.req("POST", `/posts/${p.id}/comments`, { text: "Hi" })).status).toBe(404);

    expect((await friend.req("PUT", `/posts/${p.id}/like`)).status).toBe(200);
    expect((await friend.req("PUT", `/posts/${p.id}/like`)).status).toBe(200);
    expect((await author.req("GET", `/posts/${p.id}`)).body).toMatchObject({ likeCount: 1 });
    expect((await friend.req("GET", `/posts/${p.id}`)).body.likedByMe).toBe(true);

    await author.req("PATCH", `/posts/${p.id}`, { visibility: "public" });
    await another.req("PUT", `/posts/${p.id}/like`);
    const likeNotes = (await author.req("GET", "/notifications")).body.filter((n: { kind: string }) => n.kind === "post_like");
    expect(likeNotes).toHaveLength(1);

    expect((await friend.req("POST", `/posts/${p.id}/comments`, { text: "Beautiful" })).status).toBeLessThan(300);
    expect((await friend.req("POST", `/posts/${p.id}/comments`, { text: "   " })).status).toBe(422);
    const comments = (await author.req("GET", `/posts/${p.id}/comments`)).body;
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ text: "Beautiful", canDelete: true });
    expect((await author.req("GET", "/notifications")).body.map((n: { kind: string }) => n.kind)).toContain("post_comment");

    expect((await another.req("DELETE", `/posts/${p.id}/comments/${comments[0].id}`)).status).toBe(403);
    expect((await friend.req("DELETE", `/posts/${p.id}/like`)).status).toBe(200);
    expect((await author.req("GET", `/posts/${p.id}`)).body.likeCount).toBe(1);
    expect((await author.req("DELETE", `/posts/${p.id}/comments/${comments[0].id}`)).status).toBe(200);
  });

  it("hides comments from someone you've blocked", async () => {
    const author = await Client.person("Author");
    const pest = await Client.person("Pest");
    const p = await post(author, "public");
    await pest.req("POST", `/posts/${p.id}/comments`, { text: "Rude" });
    await author.req("POST", "/blocks", { userId: pest.id });
    expect((await author.req("GET", `/posts/${p.id}/comments`)).body).toEqual([]);
  });
});

describe("sharing a memory as a post", () => {
  async function tripWithPhoto(owner: Client) {
    const tripId = id("trip");
    const trip = await owner.req("POST", "/trips", { id: tripId, name: "Memory Trip", destination: "Goa", cover: COVER, startDate: "2031-01-01", endDate: "2031-01-03" });
    expect(trip.status).toBe(201);
    const file = await owner.upload("shared", tripId);
    const photoId = id("ph");
    expect((await owner.req("PUT", `/trips/${tripId}/photos/${photoId}`, { url: file.body.url, caption: "Sunset", day: 0, album: "Uploads", kind: "photo" })).status).toBeLessThan(300);
    return { tripId, joinCode: trip.body.joinCode as string, photoId, url: file.body.url as string };
  }

  it("makes a separate copy: deleting either leaves the other, and the trip's photo stays private", async () => {
    const owner = await Client.person("Owner");
    const stranger = await Client.person("Stranger");
    const m = await tripWithPhoto(owner);
    const postId = id("post");
    const shared = await owner.req("POST", "/posts", { id: postId, caption: "Sunset over the beach", visibility: "public", fromPhotoId: m.photoId, tripId: m.tripId });
    expect(shared.status).toBeLessThan(300);
    const postPhoto = shared.body.photos[0] as string;
    expect(postPhoto).not.toBe(m.url);

    expect((await stranger.file(postPhoto)).status).toBe(200);
    expect((await stranger.file(m.url)).status).toBe(404);
    expect((await stranger.req("GET", `/trips/${m.tripId}`)).status).toBeGreaterThanOrEqual(403);

    const trip = (await owner.req("GET", `/trips/${m.tripId}`)).body;
    expect(trip.photos.find((p: { id: string }) => p.id === m.photoId)).toMatchObject({ caption: "Sunset", url: m.url });

    expect((await owner.req("DELETE", `/trips/${m.tripId}/photos/${m.photoId}`)).status).toBeLessThan(300);
    expect((await stranger.file(postPhoto)).status).toBe(200);
    expect((await owner.file(m.url)).status).toBe(404);

    const second = await tripWithPhoto(owner);
    const secondPost = id("post");
    await owner.req("POST", "/posts", { id: secondPost, visibility: "friends", fromPhotoId: second.photoId });
    expect((await owner.req("DELETE", `/posts/${secondPost}`)).status).toBe(200);
    expect((await owner.file(second.url)).status).toBe(200);
    expect((await owner.req("GET", `/trips/${second.tripId}`)).body.photos).toHaveLength(1);
  });

  it("only works for the person who added the photo", async () => {
    const owner = await Client.person("Owner");
    const member = await Client.person("Member");
    const outsider = await Client.person("Outsider");
    const m = await tripWithPhoto(owner);
    await member.req("POST", `/invites/${m.joinCode}/accept`);
    expect((await member.req("POST", "/posts", { id: id("post"), visibility: "public", fromPhotoId: m.photoId })).status).toBe(404);
    expect((await outsider.req("POST", "/posts", { id: id("post"), visibility: "public", fromPhotoId: m.photoId })).status).toBe(404);
  });
});

describe("sharing a post into a trip chat", () => {
  it("doesn't widen who can see it", async () => {
    const author = await Client.person("Author");
    const tripmate = await Client.person("Tripmate");
    const tripId = id("trip");
    const trip = await author.req("POST", "/trips", { id: tripId, name: "Chat Trip", destination: "Goa", cover: COVER, startDate: "2031-01-01", endDate: "2031-01-03" });
    await tripmate.req("POST", `/invites/${trip.body.joinCode}/accept`);
    const p = await post(author, "only_me");
    const messageId = id("msg");
    expect((await author.req("PUT", `/trips/${tripId}/messages/${messageId}`, { kind: "post", text: "", postId: p.id })).status).toBeLessThan(300);
    const message = (await tripmate.req("GET", `/trips/${tripId}`)).body.messages.find((x: { id: string }) => x.id === messageId);
    expect(message).toMatchObject({ kind: "post", postId: p.id });
    expect((await tripmate.req("GET", `/posts/${p.id}`)).status).toBe(404);

    const outsider = await Client.person("Outsider");
    const notMine = await post(outsider, "only_me");
    expect((await author.req("PUT", `/trips/${tripId}/messages/${id("msg")}`, { kind: "post", text: "", postId: notMine.id })).status).toBe(422);
  });
});

describe("reports and account deletion", () => {
  it("lets people report a post they can see, and an admin remove it", async () => {
    const admin = await Client.person("Moderator", { email: ADMIN_EMAIL });
    const author = await Client.person("Author");
    const viewer = await Client.person("Viewer");
    const p = await post(author, "public");
    const hidden = await post(author, "only_me");
    expect((await viewer.req("POST", "/reports", { targetType: "post", targetId: hidden.id, reason: "spam" })).status).toBe(404);
    const details = `Spam post ${tag}`;
    expect((await viewer.req("POST", "/reports", { targetType: "post", targetId: p.id, reason: "spam", details })).status).toBeLessThan(300);
    const row = (await admin.req("GET", "/admin/reports")).body.find((r: { details: string }) => r.details === details);
    expect(row).toMatchObject({ targetType: "post", post: { id: p.id, exists: true } });
    expect((await viewer.req("POST", `/admin/posts/${p.id}/remove`)).status).toBe(404);
    expect((await admin.req("POST", `/admin/posts/${p.id}/remove`)).status).toBe(200);
    expect((await viewer.req("GET", `/posts/${p.id}`)).status).toBe(404);
  });

  it("takes someone's posts, likes and comments with them", async () => {
    const leaver = await Client.person("Leaver");
    const other = await Client.person("Other");
    const theirs = await post(leaver, "public");
    const mine = await post(other, "public");
    await leaver.req("PUT", `/posts/${mine.id}/like`);
    await leaver.req("POST", `/posts/${mine.id}/comments`, { text: "Bye" });
    expect((await leaver.req("POST", "/me/delete", { password: "correct-horse" })).status).toBe(200);
    expect((await other.req("GET", `/posts/${theirs.id}`)).status).toBe(404);
    expect((await other.file(theirs.photo)).status).toBe(404);
    expect((await other.req("GET", `/posts/${mine.id}`)).body).toMatchObject({ likeCount: 0, commentCount: 0 });
  });
});

afterAll(() => db.$disconnect());
