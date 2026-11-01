// Runs against a live server and Mailpit (`pnpm run db:up`, `pnpm run dev`).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { allocate, convertedBalances, correctionTransfers } from "../src/common/money.js";

const BASE = process.env.API_URL ?? "http://localhost:4000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const COVER = "https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3";
const tag = randomUUID().slice(0, 8);
const id = (p: string) => `${p}-${randomUUID().slice(0, 12)}`;

class Client {
  cookie = "";
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
}

/** The newest email to an address with this subject, waiting briefly because sending happens after the response. */
async function mailTo(address: string, subject: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const found = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}" subject:"${subject}"`)}`)).json()) as { messages: { ID: string }[] };
    if (found.messages?.length) return ((await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json()) as { Text: string }).Text;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No "${subject}" email reached ${address}`);
}

const mailCount = async (address: string, subject: string) =>
  ((await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}" subject:"${subject}"`)}`)).json()) as { messages: unknown[] }).messages?.length ?? 0;

const tokenIn = (text: string, route: string) => text.match(new RegExp(`/${route}/([\\w-]+)`))?.[1] as string;

let n = 0;
async function signUp(name: string, email = `${name.toLowerCase()}-${tag}-${++n}@example.test`) {
  const c = new Client();
  const r = await c.req("POST", "/auth/signup", { name, email, password: "correct-horse" });
  expect(r.status).toBe(201);
  return { c, email, user: (await c.req("GET", "/state")).body.user as { id: string } };
}

async function verify(u: { email: string }) {
  const token = tokenIn(await mailTo(u.email, "Verify your TripOS email"), "verify-email");
  expect((await new Client().req("POST", "/auth/verify-email", { token })).status).toBe(200);
}

const newTrip = (over: Record<string, unknown> = {}) => ({ id: id("trip"), name: "Goa Weekend", destination: "Goa", cover: COVER, startDate: "2030-03-01", endDate: "2030-03-05", ...over });
const expense = (paidBy: string, ids: string[], amount: number, over: Record<string, unknown> = {}) => {
  const each = Math.floor((amount / ids.length) * 100) / 100;
  const rem = Math.round((amount - each * ids.length) * 100) / 100;
  return { title: "Dinner", amount, category: "food", paidBy, date: "2030-03-01", splitType: "equal", shares: ids.map((memberId, i) => ({ memberId, amount: Math.round((each + (i === 0 ? rem : 0)) * 100) / 100 })), ...over };
};

describe("email verification", () => {
  it("emails a link at signup, and it works once", async () => {
    const u = await signUp("Asha");
    expect((await u.c.req("GET", "/state")).body.emailVerified).toBe(false);
    const token = tokenIn(await mailTo(u.email, "Verify your TripOS email"), "verify-email");
    expect((await new Client().req("POST", "/auth/verify-email", { token })).status).toBe(200);
    expect((await u.c.req("GET", "/state")).body.emailVerified).toBe(true);
    expect((await new Client().req("POST", "/auth/verify-email", { token })).status).toBe(422);
  });

  it("rejects a made-up link", async () => {
    expect((await new Client().req("POST", "/auth/verify-email", { token: "not-a-real-token-at-all" })).status).toBe(422);
  });

  it("doesn't flood an inbox when asked repeatedly", async () => {
    const u = await signUp("Flood");
    await mailTo(u.email, "Verify your TripOS email");
    for (let i = 0; i < 4; i++) expect((await u.c.req("POST", "/auth/resend-verification")).status).toBe(200);
    await new Promise((r) => setTimeout(r, 400));
    expect(await mailCount(u.email, "Verify your TripOS email")).toBe(1);
  });

  it("makes a new address prove itself all over again", async () => {
    const u = await signUp("Mover");
    await verify(u);
    const next = `moved-${tag}@example.test`;
    expect((await u.c.req("PATCH", "/me", { email: next })).status).toBe(200);
    expect((await u.c.req("GET", "/state")).body.emailVerified).toBe(false);
    await mailTo(next, "Verify your TripOS email");
  });
});

describe("password reset by email", () => {
  it("sends a working link that also verifies the address", async () => {
    const u = await signUp("Forgetful");
    expect((await new Client().req("POST", "/auth/forgot-password", { email: u.email })).status).toBe(200);
    const token = tokenIn(await mailTo(u.email, "Reset your TripOS password"), "reset-password");
    expect((await new Client().req("POST", "/auth/reset-password", { token, password: "a-brand-new-password" })).status).toBe(200);
    expect((await new Client().req("POST", "/auth/login", { email: u.email, password: "correct-horse" })).status).toBe(401);
    const c = new Client();
    expect((await c.req("POST", "/auth/login", { email: u.email, password: "a-brand-new-password" })).status).toBe(200);
    expect((await c.req("GET", "/state")).body.emailVerified).toBe(true);
    expect((await new Client().req("POST", "/auth/reset-password", { token, password: "another-password" })).status).toBe(422);
  });

  it("answers the same whether or not the account exists", async () => {
    const r = await new Client().req("POST", "/auth/forgot-password", { email: `nobody-${tag}@example.test` });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, emailEnabled: true });
  });
});

describe("email invites", () => {
  it("refuses to send invites from an unverified account", async () => {
    const u = await signUp("Spammer");
    const trip = await u.c.req("POST", "/trips", newTrip());
    const r = await u.c.req("POST", `/trips/${trip.body.id}/members`, { email: `target-${tag}@example.test` });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("EMAIL_NOT_VERIFIED");
    expect((await u.c.req("POST", "/trips", newTrip({ members: [{ email: `target-${tag}@example.test` }] }))).status).toBe(403);
    expect(await mailCount(`target-${tag}@example.test`, "invited you")).toBe(0);
  });

  it("emails the invitee, who can accept once they've proved the address is theirs", async () => {
    const owner = await signUp("Owner");
    await verify(owner);
    const trip = await owner.c.req("POST", "/trips", newTrip({ name: "Secret Goa Plan" }));
    const email = `invitee-${tag}@example.test`;
    expect((await owner.c.req("POST", `/trips/${trip.body.id}/members`, { email })).status).toBe(201);
    const text = await mailTo(email, "invited you to Secret Goa Plan");
    expect(text).toContain(`/signup?email=${encodeURIComponent(email)}`);

    const invitee = await signUp("Invitee", email);
    const before = (await invitee.c.req("GET", "/state")).body;
    expect(JSON.stringify(before)).not.toContain("Secret Goa Plan");
    await verify(invitee);
    const after = (await invitee.c.req("GET", "/state")).body;
    const notification = after.notifications.find((x: { kind: string }) => x.kind === "invite");
    expect(notification.title).toContain("Secret Goa Plan");
    expect((await invitee.c.req("POST", `/notifications/${notification.id}/accept`)).status).toBe(200);
    expect((await invitee.c.req("GET", `/trips/${trip.body.id}`)).status).toBe(200);
  });

  it("gives an impostor nothing, and lets the real owner take the account back", async () => {
    const owner = await signUp("TripOwner");
    await verify(owner);
    const trip = await owner.c.req("POST", "/trips", newTrip({ name: "Private Passport Trip" }));
    const victim = `victim-${tag}@example.test`;
    await owner.c.req("POST", `/trips/${trip.body.id}/members`, { email: victim });
    await mailTo(victim, "invited you");

    const impostor = await signUp("Impostor", victim);
    const seen = (await impostor.c.req("GET", "/state")).body;
    expect(JSON.stringify(seen)).not.toContain("Private Passport Trip");
    expect(seen.notifications).toEqual([]);
    expect((await impostor.c.req("GET", `/trips/${trip.body.id}`)).status).toBe(403);

    // Even with the notification's id, unverified accounts can't accept or decline.
    const ownerCopy = (await owner.c.req("GET", `/trips/${trip.body.id}`)).body;
    expect(ownerCopy.members.find((m: { email: string }) => m.email === victim).status).toBe("invited");
    const guessed = await impostor.c.req("POST", "/notifications/some-notification-id/accept");
    expect(guessed.status).toBe(403);

    // The real owner proves the inbox is theirs with a reset link, which ends the impostor's session.
    await new Client().req("POST", "/auth/forgot-password", { email: victim });
    const token = tokenIn(await mailTo(victim, "Reset your TripOS password"), "reset-password");
    await new Client().req("POST", "/auth/reset-password", { token, password: "the-real-owner-pw" });
    expect((await impostor.c.req("GET", "/state")).status).toBe(401);
    const real = new Client();
    await real.req("POST", "/auth/login", { email: victim, password: "the-real-owner-pw" });
    const invites = (await real.req("GET", "/state")).body.notifications.filter((x: { kind: string }) => x.kind === "invite");
    expect(invites[0].title).toContain("Private Passport Trip");
  });

  it("sends existing users to log in instead", async () => {
    const owner = await signUp("Host");
    await verify(owner);
    const friend = await signUp("Friend");
    const trip = await owner.c.req("POST", "/trips", newTrip({ name: "Friends Trip" }));
    await owner.c.req("POST", `/trips/${trip.body.id}/members`, { email: friend.email });
    expect(await mailTo(friend.email, "invited you to Friends Trip")).toContain("/login?email=");
  });

  it("escapes names so an email can't carry someone's HTML", async () => {
    const owner = await signUp("Hacker");
    await verify(owner);
    const trip = await owner.c.req("POST", "/trips", newTrip({ name: `<img src=x onerror=alert(1)>` }));
    const email = `html-${tag}@example.test`;
    await owner.c.req("POST", `/trips/${trip.body.id}/members`, { email });
    await mailTo(email, "invited you");
    const found = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()) as { messages: { ID: string }[] };
    const message = (await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json()) as { HTML: string };
    expect(message.HTML).not.toContain("<img src=x");
    expect(message.HTML).toContain("&lt;img");
  });
});

describe("currency", () => {
  let owner: Awaited<ReturnType<typeof signUp>>;
  let member: Awaited<ReturnType<typeof signUp>>;
  let third: Awaited<ReturnType<typeof signUp>>;
  beforeAll(async () => {
    [owner, member, third] = await Promise.all([signUp("Payer"), signUp("Sharer"), signUp("Third")]);
  });

  async function moneyTrip() {
    const t = await owner.c.req("POST", "/trips", newTrip({ budget: 90000, perPersonBudget: 30000 }));
    await member.c.req("POST", `/invites/${t.body.joinCode}/accept`);
    await third.c.req("POST", `/invites/${t.body.joinCode}/accept`);
    return t.body.id as string;
  }
  const load = async (tripId: string) => (await owner.c.req("GET", `/trips/${tripId}`)).body;
  const ledger = async (tripId: string) => (await owner.c.req("GET", `/trips/${tripId}/balances`)).body as Record<string, number>;
  const uiBalances = (t: any) => {
    const b: Record<string, number> = {};
    const add = (k: string, v: number) => (b[k] = Math.round(((b[k] ?? 0) + v) * 100) / 100);
    for (const e of t.expenses) {
      add(e.paidBy, e.amount);
      for (const s of e.shares) add(s.memberId, -s.amount);
    }
    for (const s of t.settlements) {
      add(s.from, s.amount);
      add(s.to, -s.amount);
    }
    return b;
  };

  it("won't relabel amounts: a trip with money must be converted", async () => {
    const tripId = await moneyTrip();
    const r = await owner.c.req("PATCH", `/trips/${tripId}`, { currency: "USD" });
    expect(r.status).toBe(409);
    expect((await load(tripId)).currency).toBe("INR");
  });

  it("still lets an empty trip change currency freely", async () => {
    const t = await owner.c.req("POST", "/trips", newTrip());
    expect((await owner.c.req("PATCH", `/trips/${t.body.id}`, { currency: "USD" })).status).toBe(200);
    expect((await owner.c.req("GET", `/trips/${t.body.id}`)).body.currency).toBe("USD");
  });

  it("only lets admins convert", async () => {
    const tripId = await moneyTrip();
    expect((await member.c.req("POST", `/trips/${tripId}/convert-currency`, { currency: "USD", rate: 0.012 })).status).toBe(403);
    expect((await owner.c.req("POST", `/trips/${tripId}/convert-currency`, { currency: "USD", rate: 0 })).status).toBe(422);
    expect((await owner.c.req("POST", `/trips/${tripId}/convert-currency`, { currency: "INR", rate: 2 })).status).toBe(409);
  });

  it("converts everything, keeps shares exact and keeps the ledger in step", async () => {
    const tripId = await moneyTrip();
    const ids = [owner.user.id, member.user.id, third.user.id];
    await owner.c.req("PUT", `/trips/${tripId}/expenses/${id("exp")}`, expense(owner.user.id, ids, 1000));
    await member.c.req("PUT", `/trips/${tripId}/expenses/${id("exp")}`, expense(member.user.id, ids, 333.33));
    await owner.c.req("PUT", `/trips/${tripId}/activities/${id("act")}`, { day: 0, title: "Paragliding", start: "09:00", end: "10:00", cost: 3000, assignees: [] });
    expect((await owner.c.req("POST", `/trips/${tripId}/convert-currency`, { currency: "USD", rate: 0.012 })).status).toBe(200);

    const t = await load(tripId);
    expect(t.currency).toBe("USD");
    expect(t.budget).toBe(1080);
    expect(t.perPersonBudget).toBe(360);
    expect(t.activities[0].cost).toBe(36);
    expect(t.expenses.map((e: { amount: number }) => e.amount).sort()).toEqual([12, 4]);
    for (const e of t.expenses) expect(e.shares.reduce((s: number, x: { amount: number }) => s + Math.round(x.amount * 100), 0)).toBe(Math.round(e.amount * 100));
    const fromLedger = await ledger(tripId);
    const fromUi = uiBalances(t);
    for (const k of Object.keys(fromUi)) expect(fromLedger[k]).toBeCloseTo(fromUi[k], 2);
    expect(Object.values(fromLedger).reduce((s, v) => s + Math.round(v * 100), 0)).toBe(0);
    expect(t.events.some((e: { text: string }) => e.text.includes("converted the trip from INR to USD"))).toBe(true);
  });

  it("keeps settled people exactly settled, whatever the rounding", async () => {
    const tripId = await moneyTrip();
    const ids = [owner.user.id, member.user.id, third.user.id];
    await owner.c.req("PUT", `/trips/${tripId}/expenses/${id("exp")}`, expense(owner.user.id, ids, 100));
    const balances = await ledger(tripId);
    await member.c.req("PUT", `/trips/${tripId}/settlements/${id("set")}`, { from: member.user.id, to: owner.user.id, amount: -balances[member.user.id], date: "2030-03-02" });
    await third.c.req("PUT", `/trips/${tripId}/settlements/${id("set")}`, { from: third.user.id, to: owner.user.id, amount: -balances[third.user.id], date: "2030-03-02" });
    expect(Object.values(await ledger(tripId)).every((v) => v === 0)).toBe(true);
    await owner.c.req("POST", `/trips/${tripId}/convert-currency`, { currency: "USD", rate: 0.0119 });
    const after = await ledger(tripId);
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
    const t = await load(tripId);
    const fromUi = uiBalances(t);
    expect(Object.values(fromUi).every((v) => v === 0)).toBe(true);
  });

  it("records a foreign expense at the rate paid, and rejects a wrong conversion", async () => {
    const tripId = await moneyTrip();
    const expenseId = id("exp");
    const r = await owner.c.req("PUT", `/trips/${tripId}/expenses/${expenseId}`, expense(owner.user.id, [owner.user.id, member.user.id], 4175, { original: { amount: 50, currency: "USD", rate: 83.5 } }));
    expect(r.status).toBe(200);
    const e = (await load(tripId)).expenses.find((x: { id: string }) => x.id === expenseId);
    expect(e.amount).toBe(4175);
    expect(e.original).toEqual({ amount: 50, currency: "USD", rate: 83.5 });
    expect((await owner.c.req("PUT", `/trips/${tripId}/expenses/${id("exp")}`, expense(owner.user.id, [owner.user.id], 9999, { original: { amount: 50, currency: "USD", rate: 83.5 } }))).status).toBe(422);
  });

  it("works out shares and balances exactly in pure code", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [3334, 3333, 3333]).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(allocate(5, [0, 0])).toEqual([5, 0]);
    const target = convertedBalances({ a: 6666, b: -3333, c: -3333 }, 0.012);
    expect(Object.values(target).reduce((a, b) => a + b, 0)).toBe(0);
    expect(correctionTransfers({ a: 1, b: -1 }, { a: 0, b: 0 })).toEqual([{ from: "b", to: "a", amountMinor: 1 }]);
    expect(correctionTransfers({ a: 0 }, { a: 0 })).toEqual([]);
  });
});

describe("other product gaps", () => {
  let owner: Awaited<ReturnType<typeof signUp>>;
  let tripId: string;
  beforeAll(async () => {
    owner = await signUp("Planner");
    tripId = (await owner.c.req("POST", "/trips", newTrip())).body.id;
  });
  const load = async () => (await owner.c.req("GET", `/trips/${tripId}`)).body;

  it("requires a cover image on new trips", async () => {
    expect((await owner.c.req("POST", "/trips", newTrip({ cover: "" }))).status).toBe(422);
  });

  it("stores activity types", async () => {
    const a = id("act");
    await owner.c.req("PUT", `/trips/${tripId}/activities/${a}`, { day: 0, type: "meal", title: "Lunch", start: "12:00", end: "13:00", assignees: [] });
    expect((await load()).activities.find((x: { id: string }) => x.id === a).type).toBe("meal");
    expect((await owner.c.req("PUT", `/trips/${tripId}/activities/${id("act")}`, { day: 0, type: "party", title: "Bad", start: "12:00", end: "13:00" })).status).toBe(422);
  });

  it("keeps task status and done in agreement", async () => {
    const t = id("task");
    const body = { title: "Book cabs", assignee: owner.user.id, due: "2030-02-01", priority: "high" };
    await owner.c.req("PUT", `/trips/${tripId}/tasks/${t}`, { ...body, status: "in_progress" });
    const get = async () => (await load()).tasks.find((x: { id: string }) => x.id === t);
    expect(await get()).toMatchObject({ status: "in_progress", done: false });
    await owner.c.req("PUT", `/trips/${tripId}/tasks/${t}`, { ...body, status: "done", version: 1 });
    expect(await get()).toMatchObject({ status: "done", done: true });
    await owner.c.req("PUT", `/trips/${tripId}/tasks/${t}`, { ...body, done: false, version: 2 });
    expect(await get()).toMatchObject({ status: "todo", done: false });
  });

  it("stores itinerary attachments as real files, only from this trip", async () => {
    const a = id("act");
    await owner.c.req("PUT", `/trips/${tripId}/activities/${a}`, { day: 0, title: "Ferry", start: "09:00", end: "10:00", assignees: [] });
    const form = new FormData();
    form.append("file", new Blob(["%PDF-1.4 ticket"], { type: "application/pdf" }), "ferry.pdf");
    form.append("visibility", "shared");
    form.append("tripId", tripId);
    const uploaded = (await (await fetch(`${BASE}/api/files`, { method: "POST", headers: { Cookie: owner.c.cookie }, body: form })).json()) as { url: string };
    expect((await owner.c.req("POST", `/trips/${tripId}/activities/${a}/attachments`, { name: "ferry.pdf", url: uploaded.url })).status).toBe(201);
    const activity = (await load()).activities.find((x: { id: string }) => x.id === a);
    expect(activity.attachments).toEqual([{ name: "ferry.pdf", url: uploaded.url }]);
    expect((await owner.c.req("POST", `/trips/${tripId}/activities/${a}/attachments`, { name: "x", url: "/api/files/somebody-elses-file" })).status).toBe(422);
  });

  it("saves Trip Replay highlights", async () => {
    await owner.c.req("PATCH", `/trips/${tripId}`, { highlights: ["The sunset at Chapora"] });
    expect((await load()).highlights).toEqual(["The sunset at Chapora"]);
  });
});
