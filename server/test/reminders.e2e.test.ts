// Runs against a live server and Mailpit (`pnpm run db:up`, `pnpm run dev`).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";

// The job looks at everyone in the database, which in a test database is a lot of people.
vi.setConfig({ testTimeout: 60_000 });

const BASE = process.env.API_URL ?? "http://localhost:4000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const SECRET = process.env.JOBS_SECRET as string;
const COVER = "https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }) });

// A Monday far enough ahead that no other test's trips or tasks land near it.
const MONDAY = "2031-01-06";
const IN_3_DAYS = "2031-01-09";
const TOMORROW = "2031-01-07";

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
  static async signUp(name: string, { verified = true } = {}) {
    const c = new Client();
    c.email = `${name}-${randomUUID().slice(0, 8)}@example.test`;
    expect((await c.req("POST", "/auth/signup", { name: `${name} Tester`, email: c.email, password: "correct-horse" })).status).toBeLessThan(300);
    c.id = (await c.req("GET", "/state")).body.user.id;
    if (verified) await db.user.update({ where: { id: c.id }, data: { emailVerifiedAt: new Date() } });
    return c;
  }
}

const runJob = (today = MONDAY, secret = SECRET) =>
  fetch(`${BASE}/api/jobs/daily`, { method: "POST", headers: { "Content-Type": "application/json", ...(secret ? { "x-jobs-secret": secret } : {}) }, body: JSON.stringify({ today }) });

async function emailsTo(address: string) {
  const found = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)).json()) as { messages?: { ID: string; Subject: string }[] };
  return found.messages ?? [];
}

async function bodyOf(id: string) {
  return ((await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string }).Text;
}

/** Everything but the verification email. */
const reminders = async (address: string) => (await emailsTo(address)).filter((m) => !m.Subject.includes("Verify"));

async function waitForEmail(address: string, subject: string) {
  for (let i = 0; i < 40; i++) {
    if ((await reminders(address)).some((m) => m.Subject.includes(subject))) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No "${subject}" email reached ${address}`);
}

async function createTrip(owner: Client, name: string, startDate: string, endDate = startDate) {
  const id = `trip-${randomUUID().slice(0, 12)}`;
  const made = await owner.req("POST", "/trips", { id, name, destination: "Goa", cover: COVER, startDate, endDate });
  expect(made.status).toBe(201);
  return { id, joinCode: made.body.joinCode as string };
}

const task = (assignee: string, title: string, due: string, done = false) => ({ title, assignee, due, priority: "medium", done });

describe("the daily job", () => {
  afterAll(() => db.$disconnect());

  it("only runs with the right secret", async () => {
    expect((await runJob(MONDAY, "")).status).toBe(404);
    expect((await runJob(MONDAY, "wrong-secret-of-a-different-length")).status).toBe(404);
    expect((await runJob(MONDAY)).status).toBe(200);
  });

  describe("reminders", () => {
    let owner: Client;
    let tripId: string;

    beforeAll(async () => {
      owner = await Client.signUp("reminded");
      tripId = (await createTrip(owner, "Starting Soon", IN_3_DAYS, "2031-01-12")).id;
      await owner.req("PUT", `/trips/${tripId}/tasks/${`task-${randomUUID().slice(0, 8)}`}`, task(owner.id, "Book the ferry", TOMORROW));
      await owner.req("PUT", `/trips/${tripId}/tasks/${`task-${randomUUID().slice(0, 8)}`}`, task(owner.id, "Already finished", TOMORROW, true));
      await owner.req("PUT", `/trips/${tripId}/tasks/${`task-${randomUUID().slice(0, 8)}`}`, task(owner.id, "Far off", "2031-02-01"));
    });

    it("sends one email covering everything due, and shows it in the app", async () => {
      expect((await runJob()).status).toBe(200);
      const sent = await reminders(owner.email);
      expect(sent).toHaveLength(1);
      expect(sent[0].Subject).toBe("Your TripOS reminders");
      const body = await bodyOf(sent[0].ID);
      expect(body).toContain("Starting Soon starts in 3 days");
      expect(body).toContain("“Book the ferry” on Starting Soon is due tomorrow");
      expect(body).not.toContain("Already finished");
      expect(body).not.toContain("Far off");
      expect(body).toContain("/app/trips/");
      const inApp = (await owner.req("GET", "/state")).body.notifications.map((n: { title: string }) => n.title);
      expect(inApp).toContain("Starting Soon starts in 3 days");
      expect(inApp).toContain("A task is due tomorrow: Book the ferry");
    });

    it("never sends the same reminder twice, however often it runs", async () => {
      await runJob();
      await runJob();
      expect(await reminders(owner.email)).toHaveLength(1);
      const inApp = (await owner.req("GET", "/state")).body.notifications.filter((n: { title: string }) => n.title.includes("starts in 3 days"));
      expect(inApp).toHaveLength(1);
    });
  });

  it("reminds people of money they owe, in the trip's currency, only on Mondays", async () => {
    const owner = await Client.signUp("payer");
    const debtor = await Client.signUp("debtor");
    const { id, joinCode } = await createTrip(owner, "Owing Trip", "2031-03-01", "2031-03-05");
    await debtor.req("POST", `/invites/${joinCode}/accept`);
    const expense = await owner.req("PUT", `/trips/${id}/expenses/exp-${randomUUID().slice(0, 8)}`, {
      title: "Hotel", amount: 1000, category: "stay", paidBy: owner.id, date: "2031-03-01", splitType: "equal",
      shares: [{ memberId: owner.id, amount: 500 }, { memberId: debtor.id, amount: 500 }],
    });
    expect(expense.status).toBeLessThan(300);

    await runJob("2031-01-08");
    expect(await reminders(debtor.email)).toHaveLength(0);

    await runJob("2031-01-13");
    const sent = await reminders(debtor.email);
    expect(sent).toHaveLength(1);
    expect(sent[0].Subject).toContain("You owe ₹500 on Owing Trip");
    expect(await reminders(owner.email)).toHaveLength(0);
  });

  it("leaves out anyone who turned reminders off", async () => {
    const owner = await Client.signUp("quiet");
    const { notify } = (await owner.req("GET", "/state")).body.settings;
    await owner.req("PATCH", "/me", { notify: { ...notify, reminders: false } });
    await createTrip(owner, "Quiet Trip", IN_3_DAYS);
    await runJob();
    expect(await reminders(owner.email)).toHaveLength(0);
  });

  it("doesn't email an unverified address, but still shows the reminder in the app", async () => {
    const owner = await Client.signUp("unverified", { verified: false });
    await createTrip(owner, "Unverified Trip", IN_3_DAYS);
    await runJob();
    expect(await reminders(owner.email)).toHaveLength(0);
    const inApp = (await owner.req("GET", "/state")).body.notifications.map((n: { title: string }) => n.title);
    expect(inApp).toContain("Unverified Trip starts in 3 days");
  });

  describe("the weekly digest", () => {
    async function withUnread() {
      const reader = await Client.signUp("reader");
      const other = await Client.signUp("other");
      const { id, joinCode } = await createTrip(other, "Digest Trip", "2031-05-01");
      await reader.req("POST", `/invites/${joinCode}/accept`);
      await other.req("PUT", `/trips/${id}/tasks/task-${randomUUID().slice(0, 8)}`, task(reader.id, "Far ahead", "2031-04-20"));
      await db.notification.updateMany({ where: { userId: reader.id }, data: { at: new Date("2031-01-05T00:00:00Z") } });
      expect((await reader.req("GET", "/state")).body.notifications.length).toBeGreaterThan(0);
      return reader;
    }

    it("is off unless someone asks for it", async () => {
      const reader = await withUnread();
      await runJob("2031-01-06");
      expect(await reminders(reader.email)).toHaveLength(0);
    });

    it("sums up unread updates for people who asked for it", async () => {
      const reader = await withUnread();
      const { notify } = (await reader.req("GET", "/state")).body.settings;
      await reader.req("PATCH", "/me", { notify: { ...notify, email: true } });
      await runJob("2031-01-06");
      const sent = await reminders(reader.email);
      expect(sent).toHaveLength(1);
      expect(sent[0].Subject).toContain("This week you missed");
      expect(await bodyOf(sent[0].ID)).toContain("A task was assigned to you");
    });
  });
});

describe("update emails", () => {
  async function pair(alerts: boolean) {
    const owner = await Client.signUp("assigner");
    const member = await Client.signUp("assignee");
    const { id, joinCode } = await createTrip(owner, "Updates Trip", "2031-06-01");
    await member.req("POST", `/invites/${joinCode}/accept`);
    if (alerts) {
      const { notify } = (await member.req("GET", "/state")).body.settings;
      await member.req("PATCH", "/me", { notify: { ...notify, emailAlerts: true } });
    }
    return { owner, member, id };
  }

  it("are off by default", async () => {
    const { owner, member, id } = await pair(false);
    await owner.req("PUT", `/trips/${id}/tasks/task-${randomUUID().slice(0, 8)}`, task(member.id, "Pack the tent", "2031-05-30"));
    await new Promise((r) => setTimeout(r, 500));
    expect(await reminders(member.email)).toHaveLength(0);
  });

  it("go to people who opted in, but not for chat", async () => {
    const { owner, member, id } = await pair(true);
    await owner.req("PUT", `/trips/${id}/messages/msg-${randomUUID().slice(0, 8)}`, { kind: "text", text: "Hello there", at: new Date().toISOString() });
    await owner.req("PUT", `/trips/${id}/tasks/task-${randomUUID().slice(0, 8)}`, task(member.id, "Pack the tent", "2031-05-30"));
    await waitForEmail(member.email, "A task was assigned to you");
    const sent = await reminders(member.email);
    expect(sent).toHaveLength(1);
    expect(await bodyOf(sent[0].ID)).toContain("Pack the tent");
  });
});

describe("older chat messages", () => {
  let owner: Client;
  let tripId: string;
  const put = (n: number, at: string) => owner.req("PUT", `/trips/${tripId}/messages/msg-${String(n).padStart(3, "0")}-${tripId}`, { kind: "text", text: `Message ${n}`, at });

  beforeAll(async () => {
    owner = await Client.signUp("chatter");
    tripId = (await createTrip(owner, "Chatty Trip", "2031-07-01")).id;
    for (let n = 0; n < 5; n++) await put(n, new Date(Date.UTC(2031, 0, 1, 0, n)).toISOString());
  });

  it("pages back from a cursor, oldest first within a page, with no repeats", async () => {
    const trip = (await owner.req("GET", `/trips/${tripId}`)).body;
    const last = trip.messages[trip.messages.length - 1];
    const q = (at: string, id: string, limit: number) => `/trips/${tripId}/messages?before=${encodeURIComponent(at)}&beforeId=${encodeURIComponent(id)}&limit=${limit}`;
    const page = (await owner.req("GET", q(last.at, last.id, 2))).body;
    expect(page.hasMore).toBe(true);
    expect(page.messages).toHaveLength(2);
    expect(page.messages[0].at < page.messages[1].at).toBe(true);
    expect(page.messages.some((m: { id: string }) => m.id === last.id)).toBe(false);
    const rest = (await owner.req("GET", q(page.messages[0].at, page.messages[0].id, 50))).body;
    expect(rest.hasMore).toBe(false);
    expect(rest.messages).toHaveLength(2);
  });

  it("is only for people on the trip", async () => {
    const outsider = await Client.signUp("outsider");
    expect((await outsider.req("GET", `/trips/${tripId}/messages?before=2031-01-01T00:00:00.000Z&beforeId=x`)).status).toBe(403);
  });
});

describe("starting a trip from another", () => {
  let owner: Client;
  let member: Client;
  let sourceId: string;
  const placeId = `pl-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    owner = await Client.signUp("source");
    member = await Client.signUp("copier");
    const { id, joinCode } = await createTrip(owner, "Source Trip", "2031-08-01", "2031-08-03");
    sourceId = id;
    await member.req("POST", `/invites/${joinCode}/accept`);
    await owner.req("PUT", `/trips/${id}/places/${placeId}`, { name: "Beach", type: "activity", lat: 15, lng: 73, address: "", note: "" });
    await owner.req("PUT", `/trips/${id}/activities/act-${randomUUID().slice(0, 8)}`, { day: 1, type: "activity", title: "Swim", start: "10:00", end: "11:00", location: "Beach", placeId, cost: 200, assignees: [owner.id] });
    await owner.req("PUT", `/trips/${id}/packing/pack-${randomUUID().slice(0, 8)}`, { name: "Shared tent", category: "misc", qty: 1, scope: "shared", assignee: owner.id, packed: true });
    await owner.req("PUT", `/trips/${id}/packing/pack-${randomUUID().slice(0, 8)}`, { name: "Owner's secret item", category: "misc", qty: 1, scope: "personal", assignee: owner.id, packed: false });
    await owner.req("PUT", `/trips/${id}/tasks/task-${randomUUID().slice(0, 8)}`, task(owner.id, "A task", "2031-07-30"));
  });

  it("brings the plan to new dates, and leaves the people and money behind", async () => {
    const id = `trip-${randomUUID().slice(0, 12)}`;
    const copy = await member.req("POST", `/trips/${sourceId}/copy`, { id, name: "Second Go", startDate: "2031-12-10" });
    expect(copy.status).toBeLessThan(300);
    const t = copy.body;
    expect(t).toMatchObject({ name: "Second Go", startDate: "2031-12-10", endDate: "2031-12-12" });
    expect(t.members.map((m: { id: string; role: string }) => [m.id, m.role])).toEqual([[member.id, "owner"]]);
    expect(t.activities).toHaveLength(1);
    expect(t.activities[0]).toMatchObject({ title: "Swim", day: 1, cost: 200, assignees: [] });
    expect(t.places).toHaveLength(1);
    expect(t.activities[0].placeId).toBe(t.places[0].id);
    expect(t.places[0].id).not.toBe(placeId);
    expect(t.tasks).toEqual([]);
    expect(t.expenses).toEqual([]);
    expect(t.messages).toEqual([]);
    expect(t.packing.map((p: { name: string; packed: boolean }) => [p.name, p.packed])).toEqual([["Shared tent", false]]);
  });

  it("is refused for someone not on the trip", async () => {
    const outsider = await Client.signUp("stranger");
    expect((await outsider.req("POST", `/trips/${sourceId}/copy`, { id: `trip-${randomUUID().slice(0, 12)}`, name: "Stolen", startDate: "2031-12-10" })).status).toBe(403);
  });

  it("a saved place from another trip can't be linked to an activity", async () => {
    const other = await createTrip(owner, "Other Trip", "2031-09-01");
    const res = await owner.req("PUT", `/trips/${other.id}/activities/act-${randomUUID().slice(0, 8)}`, { day: 0, type: "activity", title: "Cross link", start: "10:00", end: "11:00", placeId });
    expect(res.status).toBe(409);
  });

  it("removing a place unlinks its activities and keeps them", async () => {
    await owner.req("DELETE", `/trips/${sourceId}/places/${placeId}`);
    const t = (await owner.req("GET", `/trips/${sourceId}`)).body;
    expect(t.activities).toHaveLength(1);
    expect(t.activities[0].placeId).toBeUndefined();
    expect(t.activities[0].location).toBe("Beach");
  });
});
