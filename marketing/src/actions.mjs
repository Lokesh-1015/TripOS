// The real TripOS flows a video can show. Each scene in an episode names one of these.
// `start` is where the page opens before recording begins; `run` is what's recorded, paced for a person.
import { sleep } from "./lib.mjs";

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
