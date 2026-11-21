// The demo world every video is recorded in: four friends and their trips, in the local app only.
// People are kept between runs; their trips are rebuilt each run so every recording starts the same.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Session, WORK, ensureDir, log, verifyToken } from "./lib.mjs";

const PASSWORD = "demo-password-1";
const unsplash = (id, w = 1200) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;
const avatar = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=320&h=320&q=80`;

export const PEOPLE = {
  ishita: { name: "Ishita Kapoor", username: "ishita.kapoor", avatar: avatar("photo-1534528741775-53994a69daeb"), styles: ["Mountains", "Road trips", "Food trails"] },
  rohan: { name: "Rohan Mehta", username: "rohan.mehta", avatar: avatar("photo-1507003211169-0a1dd7228f2d"), styles: ["Mountains", "Adventure"] },
  ananya: { name: "Ananya Joshi", username: "ananya.joshi", avatar: avatar("photo-1524504388940-b1c1722653e1"), styles: ["Beaches", "Food trails"] },
  kabir: { name: "Kabir Singh", username: "kabir.singh", avatar: avatar("photo-1500648767791-00dcc994a43e"), styles: ["Backpacking", "Road trips"] },
};
const email = (key) => `${key}.demo@example.test`;

const COVERS = { spiti: "photo-1635255506105-b74adbd94026", goa: "photo-1614082242765-7c98ca0f3df3", kasol: "photo-1597167231350-d057a45dc868" };
const GOA_PHOTOS = [
  ["photo-1614082242765-7c98ca0f3df3", "Palolem at sunset", 0],
  ["photo-1560094127-a6710fa2d266", "First swim of the trip", 0],
  ["photo-1655574515985-5ee58bc3ca5c", "The whole crew", 1],
  ["photo-1639818658593-5d70eaaaa2ba", "Beach dog adopted us", 1],
  ["photo-1699676124820-d383ef8b5aed", "Last sunset", 2],
];

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const id = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

/** Signs a demo person in, creating them the first time with a fixed username and photo. */
async function person(key) {
  const p = PEOPLE[key];
  const s = new Session(email(key));
  const login = await s.req("POST", "/auth/login", { email: s.email, password: PASSWORD });
  if (login.ok) {
    s.id = (await s.must("GET", "/state")).user.id;
    return s;
  }
  await s.must("POST", "/auth/signup", { name: p.name, email: s.email, password: PASSWORD });
  await s.must("POST", "/auth/verify-email", { token: await verifyToken(s.email) });
  // Before setup is finished, a username can be chosen freely.
  await s.must("PATCH", "/me/profile", { username: p.username, profileVisibility: "public", travelStyles: p.styles });
  await s.must("PATCH", "/me", { onboarded: true, avatar: p.avatar, travelStyles: p.styles, seenReleaseNotes: "9999-12-31" });
  s.id = (await s.must("GET", "/state")).user.id;
  log(`created demo person ${p.name}`);
  return s;
}

async function befriend(a, b) {
  const sent = await a.req("POST", "/friends/requests", { username: PEOPLE[b.key].username });
  if (!sent.ok) return; // Already friends.
  const incoming = (await b.must("GET", "/friends/requests")).incoming.find((r) => r.person.id === a.id);
  if (incoming) await b.must("POST", `/friends/requests/${incoming.id}/accept`);
}

async function photoFile(photoId) {
  const dir = ensureDir(path.join(WORK, "images"));
  const file = path.join(dir, `${photoId}.jpg`);
  if (!existsSync(file)) {
    const res = await fetch(unsplash(photoId, 1400));
    if (!res.ok) throw new Error(`Couldn't fetch demo photo ${photoId} from Unsplash (${res.status})`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(file);
}

async function trip(owner, body, joiners = []) {
  const tripId = id("trip");
  const made = await owner.must("POST", "/trips", { id: tripId, currency: "INR", ...body });
  for (const j of joiners) await j.must("POST", `/invites/${made.joinCode}/accept`);
  return tripId;
}

/** Builds the world and returns the ids the recordings need. */
export async function seed() {
  const s = {};
  for (const key of Object.keys(PEOPLE)) {
    s[key] = await person(key);
    s[key].key = key;
  }
  const { ishita, rohan, ananya, kabir } = s;
  await befriend(ishita, rohan);
  await befriend(ishita, ananya);

  // Start clean: remove last run's trips, and anything a recording added.
  for (const p of Object.values(s)) {
    const state = await p.must("GET", "/state");
    for (const t of state.trips) if (t.members.find((m) => m.id === p.id)?.role === "owner") await p.req("DELETE", `/trips/${t.id}`);
    for (const n of state.notifications) await p.req("DELETE", `/notifications/${n.id}`);
  }

  // Goa: a finished trip with photos, for Memories and Trip Replay. Kabir was on it, so he's a past co-traveller.
  const goa = await trip(ishita, { name: "Goa Weekend", destination: "South Goa", cover: unsplash(COVERS.goa), startDate: day(-45), endDate: day(-43), description: "Beaches, seafood and zero plans." }, [rohan, ananya, kabir]);
  for (const [photoId, caption, d] of GOA_PHOTOS) {
    const form = new FormData();
    form.append("visibility", "shared");
    form.append("tripId", goa);
    form.append("file", new Blob([await photoFile(photoId)], { type: "image/jpeg" }), `${photoId}.jpg`);
    const file = await ishita.must("POST", "/files", undefined, { form });
    await ishita.must("PUT", `/trips/${goa}/photos/${id("ph")}`, { url: file.url, caption, day: d, album: "Beach days", kind: "photo" });
  }
  const goaShares = (amount, people) => people.map((p) => ({ memberId: p.id, amount: amount / people.length }));
  await ishita.must("PUT", `/trips/${goa}/expenses/${id("ex")}`, { title: "Beach shack stay", amount: 9600, category: "stay", paidBy: ishita.id, date: day(-45), splitType: "equal", shares: goaShares(9600, [ishita, rohan, ananya, kabir]) });

  // Spiti: the main upcoming trip, already well planned.
  const spiti = await trip(ishita, { name: "Spiti Valley Ride", destination: "Spiti, Himachal Pradesh", cover: unsplash(COVERS.spiti), startDate: day(21), endDate: day(28), budget: 80000, description: "Eight days, four bikes, one very cold valley." }, [rohan, ananya, kabir]);
  const crew = [ishita, rohan, ananya, kabir];
  const plan = [
    [0, "travel", "Ride out of Manali", "07:00", "13:00", "Manali"],
    [0, "stay", "Check in at Chandratal camp", "16:00", "17:00", "Chandratal"],
    [1, "activity", "Sunrise at Chandratal Lake", "05:30", "07:30", "Chandratal Lake"],
    [1, "travel", "Ride to Kaza", "09:00", "15:00", "Kaza"],
    [2, "activity", "Key Monastery", "09:00", "11:00", "Key Monastery"],
    [2, "meal", "Lunch at Hikkim post office café", "12:30", "13:30", "Hikkim"],
  ];
  for (const [d, type, title, start, end, location] of plan) await ishita.must("PUT", `/trips/${spiti}/activities/${id("act")}`, { day: d, type, title, start, end, location, assignees: crew.map((p) => p.id) });
  const spend = [
    [ishita, "Homestay advance", 12000, "stay", crew],
    [rohan, "Bike rental", 6400, "transport", crew],
    [ananya, "Dinner in Kaza", 2400, "food", [ishita, rohan, ananya]],
    [ishita, "Fuel for the ride", 3200, "transport", crew],
  ];
  for (const [payer, title, amount, category, people] of spend) await payer.must("PUT", `/trips/${spiti}/expenses/${id("ex")}`, { title, amount, category, paidBy: payer.id, date: day(1), splitType: "equal", shares: goaShares(amount, people) });
  const poll = id("poll");
  const options = [["Sakya Abode", "Kaza town, hot water"], ["Zostel Kaza", "Social, budget"], ["Spiti Valley Homestay", "Quiet, home-cooked meals"]].map(([label, description]) => ({ id: id("opt"), label, description }));
  await ishita.must("PUT", `/trips/${spiti}/polls/${poll}`, { id: poll, question: "Which homestay in Kaza?", category: "hotel", options });
  await rohan.must("POST", `/trips/${spiti}/polls/${poll}/vote`, { optionId: options[0].id, selected: true });
  await ananya.must("POST", `/trips/${spiti}/polls/${poll}/vote`, { optionId: options[2].id, selected: true });
  await kabir.must("POST", `/trips/${spiti}/polls/${poll}/vote`, { optionId: options[0].id, selected: true });
  const pack = [["Thermal wear", "clothing", true], ["Riding gloves", "clothing", false], ["Power bank", "electronics", true], ["Sunscreen", "toiletries", false], ["Permits and IDs", "documents", false]];
  for (const [name, category, packed] of pack) await ishita.must("PUT", `/trips/${spiti}/packing/${id("pk")}`, { name, category, qty: 1, scope: "shared", assignee: ishita.id, packed });
  const tasks = [["Book Kaza homestay", ananya, "high"], ["Service the bikes", rohan, "medium"], ["Get inner line permits", ishita, "high"]];
  for (const [title, who, priority] of tasks) await ishita.must("PUT", `/trips/${spiti}/tasks/${id("tk")}`, { title, assignee: who.id, due: day(14), priority });

  // Kasol: just planned, nobody invited yet, for showing invitations.
  const kasol = await trip(ishita, { name: "Kasol Getaway", destination: "Kasol, Himachal Pradesh", cover: unsplash(COVERS.kasol), startDate: day(40), endDate: day(43) });

  const world = {
    ishita: { email: ishita.email, password: PASSWORD, id: ishita.id },
    people: Object.fromEntries(Object.entries(s).map(([k, p]) => [k, { id: p.id, name: PEOPLE[k].name, username: PEOPLE[k].username }])),
    trips: { goa, spiti, kasol },
    poll: { id: poll, options: options.map((o) => o.id) },
  };
  writeFileSync(path.join(ensureDir(WORK), "world.json"), JSON.stringify(world, null, 2));
  log("demo world ready: Spiti (planned), Goa (finished, with photos), Kasol (empty)");
  return world;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const { assertAppRunning } = await import("./lib.mjs");
  await assertAppRunning();
  await seed();
}
