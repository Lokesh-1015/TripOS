// The real TripOS flows a video can show. Each scene in an episode names one of these.
// `start` is where the page opens before recording begins; `run` is what's recorded, paced for a person.
import { Session, sleep } from "./lib.mjs";

/** A finger-like tap: a short pause on the target so viewers see where it is, then the click. */
async function tap(page, target, { before = 350, after = 450 } = {}) {
  const el = typeof target === "string" ? page.getByTestId(target) : target;
  await el.scrollIntoViewIfNeeded();
  await sleep(before);
  await el.click();
  await sleep(after);
}
async function type(page, testId, text, delay = 55) {
  const el = page.getByTestId(testId);
  await el.click();
  await el.pressSequentially(text, { delay });
  await sleep(250);
}
async function glide(page, pixels, ms = 900) {
  await page.evaluate(({ pixels }) => window.scrollBy({ top: pixels, behavior: "smooth" }), { pixels });
  await sleep(ms);
}
/** Glides the page so `el` sits below the caption, the way a thumb scroll would. */
async function glideTo(page, el, { gap = 175, ms = 950 } = {}) {
  await el.evaluate((node, gap) => window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY - gap, behavior: "smooth" }), gap);
  await sleep(ms);
}
/** Outlines `el` with a soft pulse for `ms`, to point at the number that matters. */
async function highlight(el, ms) {
  await el.evaluate((node) => node.classList.add("mk-hl"));
  await sleep(ms);
  await el.evaluate((node) => node.classList.remove("mk-hl"));
}
const isoIn = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const ACTIONS = {
  /** The Home screen, gently scrolled. */
  home: {
    start: () => "/app",
    run: async (page, { params }) => {
      await sleep(600);
      await glide(page, params.scroll ?? 260, 1200);
    },
  },

  /** Create trip: name, destination (the cover follows it), then start and end on the calendar. */
  createTrip: {
    start: () => "/app/trips/new",
    run: async (page, { params }) => {
      await type(page, "create-trip-name-input", params.name ?? "Spiti Valley Ride", 32);
      await type(page, "create-trip-destination-input", params.destination ?? "Spiti, Himachal", 32);
      await sleep(600);
      await tap(page, "create-trip-next-button", { after: 600 });
      await tap(page, page.locator(`[data-day="${isoIn(params.startIn ?? 21)}"] button`), { before: 250, after: 300 });
      await tap(page, page.locator(`[data-day="${isoIn((params.startIn ?? 21) + (params.nights ?? 7))}"] button`), { before: 250, after: 500 });
      await page.getByTestId("date-range-summary").scrollIntoViewIfNeeded();
    },
  },

  /** Invite by username from the members dialog: friends and past co-travellers show first. */
  inviteFriends: {
    start: ({ world }) => `/app/trips/${world.trips.kasol}`,
    run: async (page, { world, params }) => {
      await tap(page, "trip-invite-button", { after: 900 });
      const who = world.people[params.person ?? "rohan"];
      await type(page, "invite-search-input", `@${who.username.slice(0, 5)}`, 90);
      await sleep(700);
      await tap(page, page.getByTestId(`invite-pick-${who.id}`), { after: 900 });
    },
  },

  /** Vote in the trip's homestay poll. */
  vote: {
    start: ({ world }) => `/app/trips/${world.trips.spiti}`,
    // A vote left over from an earlier take would turn into "Vote removed", so clear it first.
    prepare: async (page, { world, params }) => {
      const option = page.getByTestId(`poll-option-${world.poll.options[params.option ?? 0]}`);
      if ((await option.getAttribute("aria-pressed")) === "true") {
        await option.click();
        await sleep(800);
      }
    },
    run: async (page, { world, params }) => {
      const card = page.getByTestId(`poll-card-${world.poll.id}`);
      await card.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy({ top: -120 }));
      await sleep(500);
      await tap(page, page.getByTestId(`poll-option-${world.poll.options[params.option ?? 0]}`), { after: 900 });
    },
  },

  /** Add an expense with the + button, then see who owes whom. */
  addExpense: {
    start: ({ world }) => `/app/trips/${world.trips.spiti}/expenses`,
    run: async (page, { params }) => {
      await tap(page, "trip-quick-add", { after: 500 });
      await type(page, "expense-title-input", params.title ?? "Fuel", 60);
      await type(page, "expense-amount-input", String(params.amount ?? 3200), 90);
      await tap(page, "expense-save-button", { after: 700 });
      await page.getByTestId("expenses-balances").scrollIntoViewIfNeeded();
      await sleep(600);
    },
  },

  /** The day-by-day plan, then ticking something off the shared packing list. */
  planAndPack: {
    start: ({ world }) => `/app/trips/${world.trips.spiti}/itinerary`,
    run: async (page, { params }) => {
      await sleep(700);
      await glide(page, 220, 900);
      await tap(page, "trip-mobile-more", { after: 400 });
      await tap(page, "trip-mobile-more-packing", { after: 700 });
      const shared = page.getByTestId("packing-scope-shared");
      if (await shared.isVisible().catch(() => false)) await tap(page, shared, { before: 200, after: 400 });
      const item = page.locator('[data-testid^="packing-item-"]', { hasText: params.item ?? "Riding gloves" }).first();
      await tap(page, item.locator('[data-testid^="packing-toggle-"]'), { after: 700 });
    },
  },

  /** After the trip: everyone's balance, then the fewest payments that settle it. */
  settleUp: {
    start: ({ world }) => `/app/trips/${world.trips.spiti}/expenses`,
    run: async (page, { world, params }) => {
      const me = world.people.ishita.id;
      const them = world.people[params.person ?? "kabir"].id;
      // The + button would sit over the Settle buttons this scene is about.
      await page.addStyleTag({ content: '[data-testid="trip-quick-add"] { display: none !important; }' });
      await sleep(params.pause ?? 450);
      await glideTo(page, page.getByTestId("expenses-balances"));
      await highlight(page.getByTestId(`balance-row-${me}`), params.meMs ?? 1200);
      await highlight(page.getByTestId(`balance-row-${them}`), params.themMs ?? 1300);
      await glideTo(page, page.getByTestId("settlements-list"), { gap: 230 });
      const firstName = world.people[params.person ?? "kabir"].name.split(" ")[0];
      await highlight(page.getByTestId("settlements-list").locator("li", { hasText: firstName }).first(), params.settleMs ?? 2000);
    },
  },

  /** Straight to the one payment that matters: who owes you, highlighted. */
  owes: {
    start: ({ world }) => `/app/trips/${world.trips.spiti}/expenses`,
    run: async (page, { world, params }) => {
      await page.addStyleTag({ content: '[data-testid="trip-quick-add"] { display: none !important; }' });
      await sleep(params.pause ?? 250);
      await glideTo(page, page.getByTestId("settlements-list"), { gap: 260, ms: 800 });
      const firstName = world.people[params.person ?? "kabir"].name.split(" ")[0];
      await highlight(page.getByTestId("settlements-list").locator("li", { hasText: firstName }).first(), params.ms ?? 1800);
    },
  },

  /** The shared packing list, with something ticked off. */
  packing: {
    start: ({ world }) => `/app/trips/${world.trips.spiti}/packing`,
    // Before recording: open the shared list, so the scene starts on it.
    prepare: async (page, { params }) => {
      const shared = page.getByTestId("packing-scope-shared");
      if (await shared.isVisible().catch(() => false)) await shared.click();
      await sleep(400);
      // An item ticked in an earlier take is unticked, so this take ticks it.
      const toggle = page.locator('[data-testid^="packing-item-"]', { hasText: params.item ?? "Sunscreen" }).first().locator('[data-testid^="packing-toggle-"]');
      if ((await toggle.getAttribute("aria-pressed")) === "true") {
        await toggle.click();
        await sleep(600);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    },
    run: async (page, { params }) => {
      const item = page.locator('[data-testid^="packing-item-"]', { hasText: params.item ?? "Sunscreen" }).first();
      await glideTo(page, item, { gap: 300, ms: 500 });
      await tap(page, item.locator('[data-testid^="packing-toggle-"]'), { before: 250, after: 700 });
    },
  },

  /**
   * The whole Create trip wizard, as fast as a person could: name, dates, crew, budget, create.
   * Captions each step as it happens, and remembers the new trip for the scenes after it.
   */
  speedrun: {
    start: () => "/app/trips/new",
    // Before recording: open a trip once, so its page is already loaded when the new trip opens.
    prepare: async (page, { world }) => {
      await page.goto(page.url().replace(/\/app\/trips\/new.*$/, `/app/trips/${world.trips.spiti}`));
      await page.getByTestId("trip-header-name").waitFor({ timeout: 15_000 });
      await sleep(600);
      await page.goBack();
      await page.getByTestId("create-trip-name-input").waitFor({ timeout: 15_000 });
      await sleep(600);
    },
    run: async (page, { world, params, caption, mark }) => {
      const next = () => tap(page, "create-trip-next-button", { before: 120, after: 380 });
      await caption("Name it 📍");
      mark("pop", 0.5);
      await type(page, "create-trip-name-input", params.name ?? "Goa with the crew", 26);
      await type(page, "create-trip-destination-input", params.destination ?? "Goa", 40);
      await sleep(250);
      await next();
      await caption("Pick dates 📅");
      mark("pop", 0.5);
      const start = params.startIn ?? 14;
      await tap(page, page.locator(`[data-day="${isoIn(start)}"] button`), { before: 150, after: 150 });
      await tap(page, page.locator(`[data-day="${isoIn(start + (params.nights ?? 3))}"] button`), { before: 150, after: 300 });
      mark("tick");
      await next();
      await caption("Add the crew 👯");
      mark("pop", 0.5);
      for (const who of params.crew ?? ["rohan", "ananya", "kabir"]) {
        await tap(page, page.getByTestId(`invite-pick-${world.people[who].id}`), { before: 120, after: 160 });
        mark("pop", 0.45);
      }
      await sleep(200);
      await next();
      await caption("Set a budget 💰");
      mark("pop", 0.5);
      await type(page, "create-trip-budget-input", String(params.budget ?? 40000), 45);
      await next();
      await caption("Create ✅");
      await tap(page, "create-trip-submit-button", { before: 250, after: 200 });
      await page.waitForURL(/\/app\/trips\/[^/]+$/, { timeout: 15_000 });
      mark("ding", 0.6);
      world.created = new URL(page.url()).pathname.split("/").pop();
      await caption(params.done ?? "Trip made. Crew invited. 🎉");
      await sleep(params.holdMs ?? 1100);
    },
  },

  /** On the trip just made: the crew has joined, the first expense goes in, and it's split at once. */
  firstExpense: {
    start: ({ world }) => `/app/trips/${world.created}`,
    // Before recording: the invited friends accept, so the split includes them.
    prepare: async (page, { world, params }) => {
      for (const who of params.crew ?? ["rohan", "ananya", "kabir"]) {
        const p = world.people[who];
        const s = new Session(p.email);
        await s.must("POST", "/auth/login", { email: p.email, password: p.password });
        const invite = (await s.must("GET", "/state")).notifications.find((n) => n.kind === "invite" && n.tripId === world.created);
        if (invite) await s.must("POST", `/notifications/${invite.id}/accept`);
      }
      await page.reload();
      await page.waitForLoadState("load");
      await sleep(1800);
    },
    run: async (page, { params, caption, mark, stopTimer }) => {
      await caption("First expense 💸");
      await tap(page, "trip-quick-add", { before: 200, after: 450 });
      await type(page, "expense-title-input", params.title ?? "Beach shack dinner", 26);
      await type(page, "expense-amount-input", String(params.amount ?? 4800), 50);
      await tap(page, "expense-save-button", { before: 150, after: 250 });
      mark("ding", 0.6);
      await stopTimer();
      await page.addStyleTag({ content: '[data-testid="trip-quick-add"] { display: none !important; }' });
      await glideTo(page, page.getByTestId("expenses-balances"), { gap: 290, ms: 700 });
      await caption(params.done ?? "Split 4 ways. Done. ✅");
      await sleep(params.holdMs ?? 1600);
    },
  },

  /** A finished trip's shared photos. */
  memories: {
    start: ({ world }) => `/app/trips/${world.trips.goa}/memories`,
    run: async (page) => {
      await sleep(700);
      await glide(page, 420, 1400);
      await glide(page, 420, 1400);
    },
  },

  /** Any page, opened and scrolled: for scenes that only need to show something. */
  show: {
    start: ({ world, params }) => (params.path ?? "/app").replace(/:(\w+)/g, (_, k) => world.trips[k] ?? k),
    run: async (page, { params }) => {
      await sleep(params.wait ?? 700);
      if (params.scroll) await glide(page, params.scroll, 1200);
    },
  },
};
