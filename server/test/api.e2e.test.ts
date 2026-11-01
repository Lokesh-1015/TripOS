// Runs against a live server (`pnpm run dev`) with its database up: API_URL defaults to localhost:4000.
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.API_URL ?? "http://localhost:4000";

interface Res {
  status: number;
  body: any;
}

class Client {
  cookie = "";
  async req(method: string, path: string, body?: unknown): Promise<Res> {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  }
}

const id = (p: string) => `${p}-${randomUUID().slice(0, 12)}`;
const tag = randomUUID().slice(0, 8);

async function signUp(name: string) {
  const c = new Client();
  const email = `${name.toLowerCase()}-${tag}@example.test`;
  const r = await c.req("POST", "/auth/signup", { name, email, password: "correct-horse" });
  expect(r.status).toBe(201);
  const state = await c.req("GET", "/state");
  return { c, email, user: state.body.user as { id: string } };
}

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

/** Follows the link from the verification email, so email invites are allowed for this account. */
async function verifyEmail(address: string) {
  for (let i = 0; i < 40; i++) {
    const found = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}" subject:"Verify your TripOS email"`)}`)).json()) as { messages: { ID: string }[] };
    if (found.messages?.length) {
      const { Text } = (await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json()) as { Text: string };
      const token = Text.match(/\/verify-email\/([\w-]+)/)?.[1];
      expect((await new Client().req("POST", "/auth/verify-email", { token })).status).toBe(200);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No verification email for ${address}`);
}

const newTrip = (over: Record<string, unknown> = {}) => ({ id: id("trip"), name: "Manali Adventure", destination: "Manali", cover: "https://images.unsplash.com/photo-1597167231350-d057a45dc868", startDate: "2027-03-01", endDate: "2027-03-05", budget: 90000, ...over });
const taskBody = (assignee: string, over: Record<string, unknown> = {}) => ({ title: "Book cabs", assignee, due: "2027-02-20", priority: "high", ...over });
const expenseBody = (paidBy: string, ids: string[], amount: number, over: Record<string, unknown> = {}) => {
  const each = Math.floor((amount / ids.length) * 100) / 100;
  const rem = Math.round((amount - each * ids.length) * 100) / 100;
  return { title: "Homestay", amount, category: "stay", paidBy, date: "2027-03-01", splitType: "equal", shares: ids.map((memberId, i) => ({ memberId, amount: Math.round((each + (i === 0 ? rem : 0)) * 100) / 100 })), ...over };
};

let owner: Awaited<ReturnType<typeof signUp>>;
let member: Awaited<ReturnType<typeof signUp>>;
let viewer: Awaited<ReturnType<typeof signUp>>;
let outsider: Awaited<ReturnType<typeof signUp>>;
let tripId: string;
let joinCode: string;

beforeAll(async () => {
  [owner, member, viewer, outsider] = await Promise.all([signUp("Ishita"), signUp("Rohan"), signUp("Priya"), signUp("Kabir")]);
  await verifyEmail(owner.email);
  const created = await owner.c.req("POST", "/trips", newTrip());
  expect(created.status).toBe(201);
  tripId = created.body.id;
  joinCode = created.body.joinCode;
  await member.c.req("POST", `/invites/${joinCode}/accept`);
  await viewer.c.req("POST", `/invites/${joinCode}/accept`);
  expect((await owner.c.req("PATCH", `/trips/${tripId}/members/${viewer.user.id}`, { role: "viewer" })).status).toBe(200);
});

describe("auth", () => {
  it("rejects wrong passwords and requests with no session", async () => {
    const c = new Client();
    expect((await c.req("POST", "/auth/login", { email: owner.email, password: "wrong-password" })).status).toBe(401);
    expect((await new Client().req("GET", "/state")).status).toBe(401);
  });

  it("logs in with the right password and logs out", async () => {
    const c = new Client();
    expect((await c.req("POST", "/auth/login", { email: owner.email, password: "correct-horse" })).status).toBe(200);
    expect((await c.req("GET", "/state")).status).toBe(200);
    await c.req("POST", "/auth/logout");
    const stale = new Client();
    stale.cookie = c.cookie;
    expect((await stale.req("GET", "/state")).status).toBe(401);
  });

  it("refuses a duplicate account", async () => {
    expect((await new Client().req("POST", "/auth/signup", { name: "Again", email: owner.email, password: "correct-horse" })).status).toBe(409);
  });

  it("starts new accounts empty, not on demo data", async () => {
    const fresh = await signUp(`Fresh${randomUUID().slice(0, 4)}`);
    const state = await fresh.c.req("GET", "/state");
    expect(state.body.trips).toEqual([]);
    expect(state.body.onboarded).toBe(false);
  });
});

describe("the response matches the UI's Trip type", () => {
  it("returns every field types.ts declares", async () => {
    const { body } = await owner.c.req("GET", `/trips/${tripId}`);
    for (const key of ["id", "name", "destination", "description", "cover", "startDate", "endDate", "flexibleDates", "currency", "budget", "perPersonBudget", "archived", "createdAt", "members", "activities", "expenses", "settlements", "tasks", "packing", "documents", "places", "messages", "polls", "photos", "events", "highlights"]) {
      expect(body).toHaveProperty(key);
    }
    expect(body.startDate).toBe("2027-03-01");
    expect(body.budget).toBe(90000);
    expect(body.members[0]).toMatchObject({ id: owner.user.id, role: "owner" });
    expect(body.events.at(-1).text).toContain("created the trip");
  });
});

describe("permissions", () => {
  it("hides the trip from outsiders", async () => {
    expect((await outsider.c.req("GET", `/trips/${tripId}`)).status).toBe(403);
    expect((await outsider.c.req("PUT", `/trips/${tripId}/tasks/${id("t")}`, taskBody(outsider.user.id))).status).toBe(403);
  });

  it("lets viewers read but not write", async () => {
    expect((await viewer.c.req("GET", `/trips/${tripId}`)).status).toBe(200);
    expect((await viewer.c.req("PUT", `/trips/${tripId}/tasks/${id("t")}`, taskBody(viewer.user.id))).status).toBe(403);
    expect((await viewer.c.req("POST", `/trips/${tripId}/members`, { email: "x@example.test" })).status).toBe(403);
  });

  it("stops members editing the trip, deleting it or promoting themselves", async () => {
    expect((await member.c.req("PATCH", `/trips/${tripId}`, { name: "Hijacked" })).status).toBe(403);
    expect((await member.c.req("DELETE", `/trips/${tripId}`)).status).toBe(403);
    expect((await member.c.req("PATCH", `/trips/${tripId}/members/${member.user.id}`, { role: "admin" })).status).toBe(403);
  });

  it("only hands the invite link to people who can invite", async () => {
    expect((await owner.c.req("GET", `/trips/${tripId}`)).body.joinCode).toBeTruthy();
    expect((await member.c.req("GET", `/trips/${tripId}`)).body.joinCode).toBeUndefined();
  });

  it("revokes access on removal and blocks rejoining through the link", async () => {
    const temp = await signUp(`Temp${randomUUID().slice(0, 4)}`);
    await temp.c.req("POST", `/invites/${joinCode}/accept`);
    expect((await temp.c.req("GET", `/trips/${tripId}`)).status).toBe(200);
    expect((await owner.c.req("DELETE", `/trips/${tripId}/members/${temp.user.id}`)).status).toBe(200);
    expect((await temp.c.req("GET", `/trips/${tripId}`)).status).toBe(403);
    expect((await temp.c.req("POST", `/invites/${joinCode}/accept`)).status).toBe(403);
  });

  it("can't touch another trip's record through this trip's URL", async () => {
    const other = await owner.c.req("POST", "/trips", newTrip({ name: "Other trip" }));
    const taskId = id("task");
    await owner.c.req("PUT", `/trips/${other.body.id}/tasks/${taskId}`, taskBody(owner.user.id));
    expect((await member.c.req("PUT", `/trips/${tripId}/tasks/${taskId}`, taskBody(member.user.id))).status).toBe(409);
  });
});

describe("email invites", () => {
  it("lists the invitee as pending", async () => {
    const email = `invitee-${tag}@example.test`;
    const invited = await owner.c.req("POST", `/trips/${tripId}/members`, { email });
    expect(invited.status).toBe(201);
    expect(invited.body.members.find((m: { email: string }) => m.email === email).status).toBe("invited");
  });

  it("shows a public preview for the join page", async () => {
    const preview = await new Client().req("GET", `/invites/${joinCode}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ id: tripId, name: "Manali Adventure" });
    expect(preview.body.joinCode).toBeUndefined();
    expect((await new Client().req("GET", "/invites/not-a-code")).status).toBe(404);
  });
});

describe("concurrent users", () => {
  it("keeps every comment when people post at the same time", async () => {
    const activityId = id("act");
    await owner.c.req("PUT", `/trips/${tripId}/activities/${activityId}`, { day: 0, title: "Hike", start: "09:00", end: "11:00", assignees: [] });
    const clients = [owner, member, owner, member, owner, member, owner, member];
    const results = await Promise.all(clients.map((u, i) => u.c.req("POST", `/trips/${tripId}/activities/${activityId}/comments`, { id: id("c"), text: `comment ${i}` })));
    results.forEach((r) => expect(r.status).toBe(201));
    const { body } = await owner.c.req("GET", `/trips/${tripId}`);
    expect(body.activities.find((a: { id: string }) => a.id === activityId).comments).toHaveLength(8);
  });

  it("records one vote per person, however many requests race", async () => {
    const pollId = id("poll");
    const [a, b] = [id("o"), id("o")];
    await owner.c.req("PUT", `/trips/${tripId}/polls/${pollId}`, { question: "Which hotel?", category: "hotel", options: [{ id: a, label: "A" }, { id: b, label: "B" }] });
    await Promise.all([owner.c.req("POST", `/trips/${tripId}/polls/${pollId}/vote`, { optionId: a }), member.c.req("POST", `/trips/${tripId}/polls/${pollId}/vote`, { optionId: a })]);
    await Promise.allSettled(Array.from({ length: 6 }, (_, i) => member.c.req("POST", `/trips/${tripId}/polls/${pollId}/vote`, { optionId: i % 2 ? a : b })));
    const poll = (await owner.c.req("GET", `/trips/${tripId}`)).body.polls.find((p: { id: string }) => p.id === pollId);
    const votes: string[] = poll.options.flatMap((o: { votes: string[] }) => o.votes);
    expect(votes.filter((v) => v === owner.user.id)).toHaveLength(1);
    expect(votes.filter((v) => v === member.user.id).length).toBeLessThanOrEqual(1);
  });

  it("toggles a vote off, and refuses votes on a closed poll", async () => {
    const pollId = id("poll");
    const a = id("o");
    const options = [{ id: a, label: "A" }, { id: id("o"), label: "B" }];
    await owner.c.req("PUT", `/trips/${tripId}/polls/${pollId}`, { question: "Where to?", category: "destination", options });
    await member.c.req("POST", `/trips/${tripId}/polls/${pollId}/vote`, { optionId: a });
    await member.c.req("POST", `/trips/${tripId}/polls/${pollId}/vote`, { optionId: a });
    const poll = (await owner.c.req("GET", `/trips/${tripId}`)).body.polls.find((p: { id: string }) => p.id === pollId);
    expect(poll.options[0].votes).toEqual([]);
    await owner.c.req("PUT", `/trips/${tripId}/polls/${pollId}`, { question: "Where to?", category: "destination", options, closed: true });
    expect((await member.c.req("POST", `/trips/${tripId}/polls/${pollId}/vote`, { optionId: a })).status).toBe(409);
  });

  it("refuses a stale edit instead of silently overwriting", async () => {
    const taskId = id("task");
    await owner.c.req("PUT", `/trips/${tripId}/tasks/${taskId}`, taskBody(owner.user.id));
    expect((await owner.c.req("PUT", `/trips/${tripId}/tasks/${taskId}`, taskBody(owner.user.id, { title: "First edit", version: 1 }))).status).toBe(200);
    const stale = await member.c.req("PUT", `/trips/${tripId}/tasks/${taskId}`, taskBody(owner.user.id, { title: "Second edit", version: 1 }));
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("VERSION_CONFLICT");
    const task = (await owner.c.req("GET", `/trips/${tripId}`)).body.tasks.find((t: { id: string }) => t.id === taskId);
    expect(task).toMatchObject({ title: "First edit", version: 2 });
  });

  it("treats a retried create as the same record", async () => {
    const expenseId = id("exp");
    const body = expenseBody(owner.user.id, [owner.user.id], 100, { title: "Retry test" });
    const results = await Promise.allSettled([1, 2, 3].map(() => owner.c.req("PUT", `/trips/${tripId}/expenses/${expenseId}`, body)));
    expect(results.length).toBe(3);
    const trip = (await owner.c.req("GET", `/trips/${tripId}`)).body;
    expect(trip.expenses.filter((e: { id: string }) => e.id === expenseId)).toHaveLength(1);
    await owner.c.req("DELETE", `/trips/${tripId}/expenses/${expenseId}`);
  });
});

describe("money", () => {
  let moneyTrip: string;
  beforeAll(async () => {
    const t = await owner.c.req("POST", "/trips", newTrip({ name: "Money trip" }));
    moneyTrip = t.body.id;
    await member.c.req("POST", `/invites/${t.body.joinCode}/accept`);
  });

  const balances = async () => (await owner.c.req("GET", `/trips/${moneyTrip}/balances`)).body as Record<string, number>;

  it("rejects splits that don't add up to the total", async () => {
    const r = await owner.c.req("PUT", `/trips/${moneyTrip}/expenses/${id("exp")}`, expenseBody(owner.user.id, [owner.user.id, member.user.id], 100, { splitType: "custom", shares: [{ memberId: owner.user.id, amount: 60 }, { memberId: member.user.id, amount: 30 }] }));
    expect(r.status).toBe(422);
  });

  it("splits with paise exactly and keeps decimals intact", async () => {
    const expenseId = id("exp");
    const r = await owner.c.req("PUT", `/trips/${moneyTrip}/expenses/${expenseId}`, expenseBody(owner.user.id, [owner.user.id, member.user.id], 100.01));
    expect(r.status).toBe(200);
    expect((await balances())[member.user.id]).toBe(-50);
    expect((await balances())[owner.user.id]).toBe(50);
    const e = (await owner.c.req("GET", `/trips/${moneyTrip}`)).body.expenses.find((x: { id: string }) => x.id === expenseId);
    expect(e.amount).toBe(100.01);
    expect(e.shares.reduce((s: number, x: { amount: number }) => s + Math.round(x.amount * 100), 0)).toBe(10001);
    await owner.c.req("DELETE", `/trips/${moneyTrip}/expenses/${expenseId}`);
  });

  it("recalculates on edit and delete, and settlements clear balances", async () => {
    const expenseId = id("exp");
    const both = [owner.user.id, member.user.id];
    await owner.c.req("PUT", `/trips/${moneyTrip}/expenses/${expenseId}`, expenseBody(owner.user.id, both, 1000));
    expect((await balances())[member.user.id]).toBe(-500);
    await owner.c.req("PUT", `/trips/${moneyTrip}/expenses/${expenseId}`, expenseBody(owner.user.id, both, 2000, { version: 1 }));
    expect((await balances())[member.user.id]).toBe(-1000);
    const settlementId = id("set");
    const settle = { from: member.user.id, to: owner.user.id, amount: 1000, date: "2027-03-02" };
    await member.c.req("PUT", `/trips/${moneyTrip}/settlements/${settlementId}`, settle);
    await member.c.req("PUT", `/trips/${moneyTrip}/settlements/${settlementId}`, settle);
    expect((await balances())[member.user.id]).toBe(0);
    expect((await balances())[owner.user.id]).toBe(0);
    await owner.c.req("DELETE", `/trips/${moneyTrip}/expenses/${expenseId}`);
    expect((await balances())[member.user.id]).toBe(1000);
  });

  it("only lets the author or an admin change an expense", async () => {
    const expenseId = id("exp");
    await owner.c.req("PUT", `/trips/${moneyTrip}/expenses/${expenseId}`, expenseBody(owner.user.id, [owner.user.id], 10));
    expect((await member.c.req("DELETE", `/trips/${moneyTrip}/expenses/${expenseId}`)).status).toBe(403);
    await owner.c.req("DELETE", `/trips/${moneyTrip}/expenses/${expenseId}`);
  });
});

describe("privacy", () => {
  it("never sends someone else's personal packing list", async () => {
    const itemId = id("pk");
    await owner.c.req("PUT", `/trips/${tripId}/packing/${itemId}`, { name: "Secret item", category: "misc", qty: 1, scope: "personal", assignee: owner.user.id });
    const mine = (await owner.c.req("GET", `/trips/${tripId}`)).body.packing;
    const theirs = (await member.c.req("GET", `/trips/${tripId}`)).body.packing;
    expect(mine.some((p: { id: string }) => p.id === itemId)).toBe(true);
    expect(theirs.some((p: { id: string }) => p.id === itemId)).toBe(false);
    expect((await member.c.req("PUT", `/trips/${tripId}/packing/${itemId}`, { name: "Hacked", category: "misc", qty: 1, scope: "shared", assignee: member.user.id })).status).toBe(409);
  });

  async function upload(c: Client, visibility: string, trip?: string) {
    const form = new FormData();
    form.append("file", new Blob(["%PDF-1.4 passport"], { type: "application/pdf" }), "passport.pdf");
    form.append("visibility", visibility);
    if (trip) form.append("tripId", trip);
    const res = await fetch(`${BASE}/api/files`, { method: "POST", headers: { Cookie: c.cookie }, body: form });
    return { status: res.status, body: await res.json() };
  }
  const read = (c: Client, url: string) => fetch(`${BASE}${url}`, { headers: c.cookie ? { Cookie: c.cookie } : {} });

  it("keeps a private document and its file away from other members, admins included", async () => {
    const file = await upload(member.c, "private", tripId);
    expect(file.status).toBe(201);
    const docId = id("doc");
    const doc = { name: "Passport", category: "identity", fileType: "PDF", size: "1 KB", uploadedAt: "2027-01-01", visibility: "private", dataUrl: file.body.url };
    expect((await member.c.req("PUT", `/trips/${tripId}/documents/${docId}`, doc)).status).toBe(200);
    expect((await member.c.req("GET", `/trips/${tripId}`)).body.documents.some((d: { id: string }) => d.id === docId)).toBe(true);
    expect((await owner.c.req("GET", `/trips/${tripId}`)).body.documents.some((d: { id: string }) => d.id === docId)).toBe(false);
    expect((await read(member.c, file.body.url)).status).toBe(200);
    expect((await read(owner.c, file.body.url)).status).toBe(404);
    expect((await read(new Client(), file.body.url)).status).toBe(401);
    expect((await owner.c.req("DELETE", `/trips/${tripId}/documents/${docId}`)).status).toBe(404);
    expect((await member.c.req("DELETE", `/trips/${tripId}/documents/${docId}`)).status).toBe(200);
    expect((await read(member.c, file.body.url)).status).toBe(404);
  });

  it("shares a trip file with members only, and rejects uploads from outsiders", async () => {
    const file = await upload(owner.c, "shared", tripId);
    expect((await read(member.c, file.body.url)).status).toBe(200);
    expect((await read(outsider.c, file.body.url)).status).toBe(404);
    expect((await upload(outsider.c, "shared", tripId)).status).toBe(403);
    expect((await upload(viewer.c, "shared", tripId)).status).toBe(403);
  });

  it("can't attach a file from another trip", async () => {
    const other = await member.c.req("POST", "/trips", newTrip({ name: "Elsewhere" }));
    const file = await upload(member.c, "shared", other.body.id);
    const r = await member.c.req("PUT", `/trips/${tripId}/photos/${id("ph")}`, { url: file.body.url, caption: "", day: 0, album: "Uploads", kind: "photo" });
    expect(r.status).toBe(422);
  });
});

describe("rules from the UI", () => {
  it("won't shorten a trip past planned activities", async () => {
    const t = await owner.c.req("POST", "/trips", newTrip({ name: "Short trip" }));
    await owner.c.req("PUT", `/trips/${t.body.id}/activities/${id("act")}`, { day: 4, title: "Last day", start: "09:00", end: "10:00", assignees: [] });
    expect((await owner.c.req("PATCH", `/trips/${t.body.id}`, { endDate: "2027-03-02" })).status).toBe(409);
    expect((await owner.c.req("PATCH", `/trips/${t.body.id}`, { endDate: "2027-03-08" })).status).toBe(200);
  });

  it("persists itinerary order", async () => {
    const t = await owner.c.req("POST", "/trips", newTrip({ name: "Order trip" }));
    const ids = [id("act"), id("act"), id("act")];
    for (const a of ids) await owner.c.req("PUT", `/trips/${t.body.id}/activities/${a}`, { day: 0, title: "Stop", start: "09:00", end: "10:00", assignees: [] });
    await owner.c.req("POST", `/trips/${t.body.id}/activities/reorder`, { day: 0, ids: [ids[2], ids[0], ids[1]] });
    expect((await owner.c.req("GET", `/trips/${t.body.id}`)).body.activities.map((a: { id: string }) => a.id)).toEqual([ids[2], ids[0], ids[1]]);
  });

  it("notifies other members and not the person who acted", async () => {
    const t = await owner.c.req("POST", "/trips", newTrip({ name: "Notify trip" }));
    await member.c.req("POST", `/invites/${t.body.joinCode}/accept`);
    await owner.c.req("PUT", `/trips/${t.body.id}/expenses/${id("exp")}`, expenseBody(owner.user.id, [owner.user.id, member.user.id], 500, { title: "Dinner" }));
    const of = async (u: typeof owner) => ((await u.c.req("GET", "/notifications")).body as { tripId?: string; kind: string }[]).filter((n) => n.tripId === t.body.id && n.kind === "expense");
    expect(await of(member)).toHaveLength(1);
    expect(await of(owner)).toHaveLength(0);
  });

  it("collapses a burst of chat messages into one unread notification", async () => {
    const t = await owner.c.req("POST", "/trips", newTrip({ name: "Chat trip" }));
    await member.c.req("POST", `/invites/${t.body.joinCode}/accept`);
    for (let i = 0; i < 3; i++) await owner.c.req("PUT", `/trips/${t.body.id}/messages/${id("msg")}`, { kind: "text", text: `hello ${i}` });
    const list = (await member.c.req("GET", "/notifications")).body as { tripId?: string; kind: string }[];
    expect(list.filter((n) => n.tripId === t.body.id && n.kind === "message")).toHaveLength(1);
    const trip = (await member.c.req("GET", `/trips/${t.body.id}`)).body;
    expect(trip.messages.map((m: { text: string }) => m.text)).toEqual(["hello 0", "hello 1", "hello 2"]);
  });
});

describe("live updates", () => {
  const sockets: ReturnType<typeof io>[] = [];
  afterAll(() => sockets.forEach((s) => s.close()));

  function connect(ticket: string) {
    const socket = io(BASE, { path: "/api/socket.io", auth: { ticket }, transports: ["websocket"], reconnection: false });
    sockets.push(socket);
    return new Promise<typeof socket>((resolve, reject) => {
      socket.once("ready", () => resolve(socket));
      socket.once("disconnect", () => reject(new Error("disconnected")));
      setTimeout(() => reject(new Error("timed out")), 5000);
    });
  }
  const next = (socket: ReturnType<typeof io>, event: string) =>
    new Promise<any>((resolve, reject) => {
      socket.once(event, resolve);
      setTimeout(() => reject(new Error(`no ${event}`)), 5000);
    });

  it("refuses a socket with no session", async () => {
    await expect(connect("not-a-real-ticket")).rejects.toThrow();
    await expect(connect(`${owner.user.id}.9999999999999.forged-signature`)).rejects.toThrow();
  });

  it("tells other members when a trip changes, and not outsiders", async () => {
    const ticket = async (u: { c: Client }) => (await u.c.req("GET", "/auth/realtime-ticket")).body.ticket as string;
    expect((await new Client().req("GET", "/auth/realtime-ticket")).status).toBe(401);
    const memberSocket = await connect(await ticket(member));
    const outsiderSocket = await connect(await ticket(outsider));
    let outsiderHeard = false;
    outsiderSocket.on("trip:changed", () => (outsiderHeard = true));
    const heard = next(memberSocket, "trip:changed");
    await owner.c.req("PUT", `/trips/${tripId}/tasks/${id("task")}`, taskBody(owner.user.id));
    expect(await heard).toEqual({ tripId });
    await new Promise((r) => setTimeout(r, 200));
    expect(outsiderHeard).toBe(false);
  });

  it("pushes notifications, and cuts a removed member off immediately", async () => {
    const temp = await signUp(`Live${randomUUID().slice(0, 4)}`);
    await temp.c.req("POST", `/invites/${joinCode}/accept`);
    const socket = await connect((await temp.c.req("GET", "/auth/realtime-ticket")).body.ticket);
    const notified = next(socket, "notifications:changed");
    await owner.c.req("PUT", `/trips/${tripId}/tasks/${id("task")}`, taskBody(temp.user.id));
    await notified;
    const told = next(socket, "trips:changed");
    await owner.c.req("DELETE", `/trips/${tripId}/members/${temp.user.id}`);
    await told;
    let heard = false;
    socket.on("trip:changed", () => (heard = true));
    await owner.c.req("PUT", `/trips/${tripId}/tasks/${id("task")}`, taskBody(owner.user.id));
    await new Promise((r) => setTimeout(r, 200));
    expect(heard).toBe(false);
  });
});
