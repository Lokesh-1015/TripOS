// Past exchange rates, conflict warnings, older chat, trip templates, activities on the map, and the notification
// settings, through the real UI. Rates and the map's tile service are replaced so this doesn't depend on them.
import { expect, test, type Browser, type Page } from '@playwright/test';

const COVER = 'https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3';
const TODAY = { base: 'USD', updatedAt: '2026-11-02T00:00:00.000Z', rates: { INR: 100, USD: 1, EUR: 0.5, GBP: 0.8, AED: 4, SGD: 1.25, THB: 40 } };
const stamp = Date.now().toString(36);
let counter = 0;

async function newUser(browser: Browser, name = 'Planner') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/tiles.openfreemap.org/**', (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await context.route('**/photon.komoot.io/**', (route) => route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { features: [] } }));
  await context.route('**/api/exchange-rates*', (route) => {
    const date = new URL(route.request().url()).searchParams.get('date');
    // Weekends answer with the Friday before, as the real service does.
    if (date) return route.fulfill({ json: { ...TODAY, rates: { ...TODAY.rates, INR: 80 }, date: '2026-10-16' } });
    return route.fulfill({ json: TODAY });
  });
  const page = await context.newPage();
  await page.goto('/signup');
  await page.getByTestId('signup-name-input').fill(`${name} Tester`);
  await page.getByTestId('signup-email-input').fill(`plan-${name.toLowerCase()}-${stamp}-${++counter}@example.test`);
  await page.getByTestId('signup-password-input').fill('correct-horse');
  await page.getByTestId('signup-submit-button').click();
  await page.getByTestId('onboarding-next-button').click();
  await page.getByTestId('onboarding-finish-button').click();
  await page.getByTestId('dashboard-welcome').waitFor();
  return { page, context };
}

const api = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([m, u, b]) => {
      const r = await fetch(`/api${u}`, { method: m as string, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [method, path, body] as const,
  );

async function createTrip(page: Page, over: Record<string, unknown> = {}) {
  const id = `trip-${stamp}-${++counter}`;
  const made = await api(page, 'POST', '/trips', { id, name: 'Plan Trip', destination: 'Goa', cover: COVER, startDate: '2030-03-01', endDate: '2030-03-04', ...over });
  expect(made.status).toBe(201);
  return id;
}

const activity = (over: Record<string, unknown>) => ({ day: 0, type: 'activity', title: 'Thing', start: '10:00', end: '11:00', location: '', description: '', cost: 0, notes: '', assignees: [], ...over });

test('an earlier expense suggests that day\'s rate, and a typed rate stays', async ({ browser }) => {
  const { page, context } = await newUser(browser);
  const id = await createTrip(page);
  await page.goto(`/app/trips/${id}/expenses`);
  await page.getByTestId('expenses-add-button').click();
  await page.getByTestId('expense-amount-input').fill('10');
  await page.getByTestId('expense-currency-select').click();
  await page.getByRole('option', { name: 'USD' }).click();

  await test.step('today uses today\'s rate', async () => {
    await expect(page.getByTestId('expense-rate-input')).toHaveValue('100');
    await expect(page.getByTestId('expense-rate-source')).toContainText('Today\'s market rate');
  });
  await test.step('a past date uses that day\'s rate, and says which day', async () => {
    await page.getByTestId('expense-date-input').fill('2026-10-17');
    await expect(page.getByTestId('expense-rate-input')).toHaveValue('80');
    await expect(page.getByTestId('expense-rate-source')).toContainText('Market rate for 16 Oct 2026');
    await expect(page.getByTestId('expense-rate-source')).toContainText('European Central Bank');
    await expect(page.getByTestId('expense-dialog')).toContainText('Counts as ₹800');
  });
  await test.step('a rate someone typed isn\'t replaced by changing the date', async () => {
    await page.getByTestId('expense-rate-input').fill('77');
    await page.getByTestId('expense-date-input').fill('2026-10-10');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('expense-rate-input')).toHaveValue('77');
  });
  await context.close();
});

test('overlapping plans are flagged but still allowed, and plans can\'t be left outside the dates', async ({ browser }) => {
  const { page, context } = await newUser(browser);
  const id = await createTrip(page);
  expect((await api(page, 'PUT', `/trips/${id}/activities/act-a-${stamp}`, activity({ title: 'Museum', start: '10:00', end: '12:00' }))).status).toBe(200);
  expect((await api(page, 'PUT', `/trips/${id}/activities/act-b-${stamp}`, activity({ title: 'Last day dinner', day: 3, start: '19:00', end: '20:00' }))).status).toBe(200);
  await page.goto(`/app/trips/${id}/itinerary`);

  await test.step('the form warns while choosing a time', async () => {
    await page.getByTestId('itinerary-add-activity-button').click();
    await page.getByTestId('activity-title-input').fill('Lunch');
    await expect(page.getByTestId('activity-conflict-warning')).toContainText('Museum');
    await page.getByTestId('activity-start-input').fill('12:00');
    await page.getByTestId('activity-end-input').fill('13:00');
    await expect(page.getByTestId('activity-conflict-warning')).toHaveCount(0);
    await page.getByTestId('activity-start-input').fill('11:30');
    await expect(page.getByTestId('activity-conflict-warning')).toBeVisible();
    await page.getByTestId('activity-save-button').click();
  });
  await test.step('both plans show the clash, and it was saved', async () => {
    await expect(page.getByTestId(`activity-conflict-act-a-${stamp}`)).toContainText('Lunch');
    await expect(page.getByTestId('itinerary-timeline')).toContainText('Lunch');
  });
  await test.step('shortening the trip explains the problem rather than failing later', async () => {
    await page.getByTestId('trip-edit-button').click();
    await page.getByTestId('edit-trip-end-input').fill('2030-03-02');
    await page.getByTestId('edit-trip-save-button').click();
    await expect(page.getByRole('alert').filter({ hasText: '1 planned activity is after these dates' })).toBeVisible();
    await expect(page.getByTestId('edit-trip-save-button')).toBeVisible();
    await page.getByTestId('edit-trip-cancel-button').click();
  });
  await test.step('a task due after the trip gets a note', async () => {
    await page.goto(`/app/trips/${id}/tasks`);
    await page.getByTestId('tasks-add-button').click();
    await page.getByTestId('task-due-input').fill('2030-04-01');
    await expect(page.getByTestId('task-dialog')).toContainText('That\'s after the trip ends');
  });
  await context.close();
});

test('chat can scroll back past the latest 300 messages', async ({ browser }) => {
  const { page, context } = await newUser(browser);
  const id = await createTrip(page);
  const seeded = await page.evaluate(async (tripId) => {
    let ok = 0;
    for (let start = 0; start < 305; start += 25) {
      const results = await Promise.all(Array.from({ length: Math.min(25, 305 - start) }, (_, i) => {
        const n = start + i;
        return fetch(`/api/trips/${tripId}/messages/msg-${tripId}-${String(n).padStart(3, '0')}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'text', text: `Message number ${n}.`, at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString() }),
        });
      }));
      ok += results.filter((r) => r.ok).length;
    }
    return ok;
  }, id);
  expect(seeded).toBe(305);

  await page.goto(`/app/trips/${id}/chat`);
  const chat = page.getByTestId('chat-messages');
  // The server stamps each message itself, so count them rather than assume the order they arrived in.
  await expect(page.locator('[data-testid^="chat-message-msg-"]')).toHaveCount(300);
  await page.getByTestId('chat-load-older').click();
  await expect(page.locator('[data-testid^="chat-message-msg-"]')).toHaveCount(305);
  await expect(page.getByTestId('chat-load-older')).toHaveCount(0);

  await test.step('a new message arrives below the older ones, in order', async () => {
    await page.getByTestId('chat-message-input').fill('The newest one');
    await page.getByTestId('chat-send-button').click();
    await expect(chat).toContainText('The newest one');
    await expect(page.locator('[data-testid^="chat-message-msg-"]').last()).toContainText('The newest one');
  });
  await context.close();
});

test('a small chat has nothing to load', async ({ browser }) => {
  const { page, context } = await newUser(browser);
  const id = await createTrip(page);
  await page.goto(`/app/trips/${id}/chat`);
  await page.getByTestId('chat-messages').waitFor();
  await expect(page.getByTestId('chat-load-older')).toHaveCount(0);
  await context.close();
});

test('a past trip starts a new one with its plan, on new dates', async ({ browser }) => {
  const { page, context } = await newUser(browser);
  const id = await createTrip(page, { name: 'Goa 2024', startDate: '2024-03-01', endDate: '2024-03-03' });
  await api(page, 'PUT', `/trips/${id}/activities/act-copy-${stamp}`, activity({ title: 'Beach morning', day: 1 }));
  await api(page, 'PUT', `/trips/${id}/packing/pack-copy-${stamp}`, { name: 'Sunscreen', category: 'toiletries', qty: 1, scope: 'shared', assignee: '', packed: true });
  await page.goto(`/app/trips/${id}`);
  await page.getByTestId('trip-copy-button').click();
  await expect(page.getByTestId('copy-trip-dialog')).toContainText('Members, expenses');
  await page.getByTestId('copy-trip-submit').click();
  await expect(page.getByTestId('copy-trip-dialog')).toContainText('Pick a start date');
  await page.getByTestId('copy-trip-name-input').fill('Goa 2030');
  await page.getByTestId('copy-trip-start-input').fill('2030-12-20');
  await page.getByTestId('copy-trip-submit').click();
  await expect(page.getByTestId('trip-header-name')).toHaveText('Goa 2030');
  expect(page.url()).not.toContain(id);
  await page.reload();
  await expect(page.getByTestId('trip-header-name')).toHaveText('Goa 2030');
  const newId = page.url().match(/trips\/([^/]+)/)?.[1] as string;
  const copy = (await api(page, 'GET', `/trips/${newId}`)).body;
  expect(copy).toMatchObject({ startDate: '2030-12-20', endDate: '2030-12-22' });
  expect(copy.activities[0]).toMatchObject({ title: 'Beach morning', day: 1 });
  expect(copy.packing[0]).toMatchObject({ name: 'Sunscreen', packed: false });
  await context.close();
});

test('Trip Replay\'s route follows the itinerary once activities are linked to places', async ({ browser }) => {
  const { page, context } = await newUser(browser);
  const id = await createTrip(page, { startDate: '2024-03-01', endDate: '2024-03-04' });
  // Saved in the opposite order to the visit.
  for (const [key, name, lat, lng] of [['c', 'Third stop', 15, 74], ['b', 'Second stop', 15.3, 73.9], ['a', 'First stop', 15.5, 73.8]] as const) {
    expect((await api(page, 'PUT', `/trips/${id}/places/pl-${key}-${stamp}`, { name, type: 'destination', lat, lng, address: '', note: '' })).status).toBe(200);
  }

  await test.step('with no links, it says it uses the saved order', async () => {
    await page.goto(`/app/trips/${id}/replay`);
    await expect(page.getByTestId('replay-route-note')).toContainText('In the order places were saved');
    await expect(page.getByTestId(`map-pin-pl-c-${stamp}`)).toContainText('1', { timeout: 30_000 });
  });

  await test.step('an activity can be linked to a place, which fills in its location', async () => {
    await page.goto(`/app/trips/${id}/itinerary`);
    await page.getByTestId('itinerary-add-activity-button').click();
    await page.getByTestId('activity-title-input').fill('Start here');
    await page.getByTestId('activity-place-select').click();
    await page.getByRole('option', { name: 'First stop' }).click();
    await expect(page.getByTestId('activity-location-input')).toHaveValue('First stop');
    await page.getByTestId('activity-save-button').click();
    await expect(page.getByTestId('itinerary-timeline')).toContainText('First stop');
  });

  await test.step('the route now follows the plan, day by day', async () => {
    await expect.poll(async () => (await api(page, 'GET', `/trips/${id}`)).body.activities.length).toBe(1);
    await api(page, 'PUT', `/trips/${id}/activities/act-z-${stamp}`, activity({ title: 'Later', day: 2, placeId: `pl-c-${stamp}` }));
    await api(page, 'PUT', `/trips/${id}/activities/act-y-${stamp}`, activity({ title: 'Middle', day: 1, placeId: `pl-b-${stamp}` }));
    await page.goto(`/app/trips/${id}/replay`);
    await expect(page.getByTestId('replay-route-note')).toContainText('In the order of your itinerary');
    await expect(page.getByTestId(`map-pin-pl-a-${stamp}`)).toContainText('1', { timeout: 30_000 });
    await expect(page.getByTestId(`map-pin-pl-b-${stamp}`)).toContainText('2');
    await expect(page.getByTestId(`map-pin-pl-c-${stamp}`)).toContainText('3');
  });
  await context.close();
});

test('email settings are real, with reminders on and updates off to begin with', async ({ browser }) => {
  const { page, context } = await newUser(browser);
  await page.goto('/app/settings');
  await page.getByTestId('settings-tab-notifications').click();
  await expect(page.getByText('coming soon')).toHaveCount(0);
  await expect(page.getByTestId('settings-notify-reminders')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-notify-emailAlerts')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('settings-notify-email')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('settings-notify-email').click();
  await page.getByTestId('settings-notify-reminders').click();
  await page.locator('[data-sonner-toast]', { hasText: 'Email reminders off' }).waitFor();
  await page.reload();
  await page.getByTestId('settings-tab-notifications').click();
  await expect(page.getByTestId('settings-notify-email')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('settings-notify-reminders')).toHaveAttribute('aria-checked', 'false');
  await context.close();
});
