// UX round 2: search everywhere, empty states with a next step, calm zeros, an easier Create trip,
// clearer activity, feed photos, phones, and the smaller fixes.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const LATEST_RELEASE = /id: "([^"]+)"/.exec(readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'releaseNotes.ts'), 'utf8'))?.[1];
const COVER = 'https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3';
const RECEIPT = path.join(__dirname, '..', 'fixtures', 'receipt.png');
const stamp = Date.now().toString(36);
let counter = 0;

async function verifyToken(email: string) {
  for (let i = 0; i < 80; i++) {
    const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}" subject:"Verify"`)}`)).json();
    if (found.messages?.length) {
      const text = (await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json()).Text as string;
      return text.match(/verify-email\/([\w-]+)/)?.[1] as string;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No verification email for ${email}`);
}

async function person(browser: Browser, first: string, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const name = `${first} ${stamp}`;
  const email = `${first.toLowerCase()}-${stamp}-${++counter}@example.test`;
  await page.goto('/signup');
  await page.getByTestId('signup-name-input').fill(name);
  await page.getByTestId('signup-email-input').fill(email);
  await page.getByTestId('signup-password-input').fill('correct-horse');
  await page.getByTestId('signup-submit-button').click();
  await expect(page).toHaveURL(/\/onboarding/);
  const token = await verifyToken(email);
  await page.evaluate(async ({ token, latest }) => {
    const headers = { 'Content-Type': 'application/json' };
    await fetch('/api/auth/verify-email', { method: 'POST', headers, body: JSON.stringify({ token }) });
    await fetch('/api/me', { method: 'PATCH', headers, body: JSON.stringify({ onboarded: true, seenReleaseNotes: latest }) });
  }, { token, latest: LATEST_RELEASE });
  const username = await page.evaluate(async () => (await (await fetch('/api/me/profile')).json()).username as string);
  return { page, name, email, username };
}

const api = (page: Page, method: string, url: string, body?: unknown) =>
  page.evaluate(async ({ method, url, body }) => {
    const res = await fetch(`/api${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { method, url, body });

const userId = async (p: { page: Page }) => (await api(p.page, 'GET', '/state')).body.user.id as string;
const newTrip = async (p: { page: Page }, name: string, extra: Record<string, unknown> = {}) => {
  const id = `trip-${stamp}-${++counter}`;
  const res = await api(p.page, 'POST', '/trips', { id, name, destination: 'Goa', cover: COVER, startDate: '2031-01-01', endDate: '2031-01-03', ...extra });
  expect(res.status).toBe(201);
  return { id, joinCode: res.body.joinCode as string };
};

test('one search finds your trips, people and Explore, with Ctrl+K and the keyboard', async ({ browser }) => {
  test.setTimeout(120_000);
  const me = await person(browser, 'Seeker');
  const host = await person(browser, 'Hoster');
  const word = `zq${stamp}`;
  const mine = await newTrip(me, `Valley ${word} Ride`, { destination: `Valley ${word}` });
  const theirs = await newTrip(host, `Monastery ${word} Tour`, { destination: `Valley ${word}`, visibility: 'public' });
  await me.page.goto('/app');
  await expect(me.page.getByTestId('header-search-input')).toBeVisible();

  await me.page.keyboard.press('Control+k');
  await expect(me.page.getByTestId('header-search-input')).toBeFocused();
  await me.page.keyboard.type(word);
  const results = me.page.getByTestId('search-results');
  await expect(results.getByTestId(`search-result-trip-${mine.id}`)).toBeVisible();
  await expect(results.getByTestId(`search-result-public-${theirs.id}`)).toBeVisible();
  await expect(results.getByTestId(`search-result-public-${mine.id}`)).toHaveCount(0);
  await me.page.keyboard.press('Enter');
  await expect(me.page).toHaveURL(new RegExp(`/app/trips/${mine.id}$`));
  await expect(me.page.getByTestId('header-breadcrumb')).toHaveText(`My Trips / Valley ${word} Ride`);

  const search = me.page.getByTestId('header-search-input');
  await search.fill(`@${host.username}`);
  await expect(me.page.getByTestId(`search-result-person-${await userId(host)}`)).toBeVisible();
  await search.fill(host.email);
  await expect(me.page.getByTestId('search-no-results')).toContainText('Nothing matches');
  for (const p of [me, host]) await p.page.context().close();
});

test('empty hubs offer a next step, and zero amounts stay calm', async ({ browser }) => {
  test.setTimeout(90_000);
  const me = await person(browser, 'Empty');
  const page = me.page;
  await page.goto('/app/memories');
  await expect(page.getByTestId('hub-memories-upload')).toHaveText('Create trip');
  const trip = await newTrip(me, 'Empty Hub Trip');
  await page.goto('/app/memories');
  await expect(page.getByTestId('hub-memories-upload')).toHaveText('Upload photos');
  await expect(page.getByTestId('hub-memories-upload')).toHaveAttribute('href', `/app/trips/${trip.id}/memories`);

  await page.goto('/app/documents');
  await expect(page.getByTestId('hub-documents-add')).toHaveAttribute('href', `/app/trips/${trip.id}/documents`);

  await page.goto('/app/tasks');
  await expect(page.getByTestId('hub-tasks-empty')).toContainText('Nothing on your list');
  await expect(page.getByTestId('hub-tasks-overdue')).not.toHaveClass(/text-destructive/);
  await expect(page.getByTestId('hub-tasks-overdue').locator('.text-destructive')).toHaveCount(0);
  await page.getByTestId('hub-tasks-add').click();
  await expect(page).toHaveURL(new RegExp(`/app/trips/${trip.id}/tasks`));
  await expect(page.getByTestId('task-dialog')).toBeVisible();

  await page.goto('/app/expenses');
  await expect(page.getByTestId('hub-expenses-owe').locator('.text-\\[\\#C2462F\\]')).toHaveCount(0);
  await expect(page.getByTestId(`hub-expense-trip-${trip.id}`)).toContainText('No expenses yet');
  await expect(page.getByTestId('hub-expenses-latest-empty')).toBeVisible();
  await page.getByTestId('hub-expenses-add').click();
  await expect(page.getByTestId('expense-dialog')).toBeVisible();
  await page.context().close();
});

test('People shows who you have travelled with before you search', async ({ browser }) => {
  const me = await person(browser, 'Finder');
  const mate = await person(browser, 'Tripmate');
  const trip = await newTrip(me, 'Together Trip');
  expect((await api(mate.page, 'POST', `/invites/${trip.joinCode}/accept`)).status).toBeLessThan(300);
  await me.page.goto('/app/people');
  await expect(me.page.getByTestId('people-co-travellers')).toContainText(mate.name);
  for (const p of [me, mate]) await p.page.context().close();
});

test('Create trip marks what is required, picks a cover, and warns before losing input', async ({ browser }) => {
  const me = await person(browser, 'Planner');
  const page = me.page;
  await page.goto('/app/trips/new');
  await expect(page.locator('label[for="ct-name"]')).toContainText('*');
  await expect(page.locator('label[for="ct-dest"]')).toContainText('*');
  await page.getByTestId('create-trip-name-input').fill('Backwaters');
  await page.getByTestId('create-trip-destination-input').fill('Alleppey, Kerala');
  await expect(page.locator('[data-testid^="create-trip-cover-"][aria-pressed="true"]')).toHaveAttribute('data-testid', /photo-1602216056096/);

  // The warning is TripOS's own dialog, not the browser's.
  await page.getByTestId('desktop-sidebar').getByRole('link', { name: 'My Trips' }).click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Leave without creating this trip');
  await page.getByTestId('confirm-cancel-button').click();
  await expect(page).toHaveURL(/\/app\/trips\/new$/);
  await expect(page.getByTestId('create-trip-name-input')).toHaveValue('Backwaters');
  await page.getByTestId('desktop-sidebar').getByRole('link', { name: 'My Trips' }).click();
  await page.getByTestId('confirm-accept-button').click();
  await expect(page).toHaveURL(/\/app\/trips$/);
  await page.context().close();
});

test('the activity feed says who accepted whose invitation, in one line', async ({ browser }) => {
  const host = await person(browser, 'Activity');
  const guest = await person(browser, 'Joiner');
  const trip = await newTrip(host, 'Activity Trip');
  expect((await api(host.page, 'POST', `/trips/${trip.id}/members`, { userId: await userId(guest) })).status).toBeLessThan(300);
  const invite = ((await api(guest.page, 'GET', '/state')).body.notifications as { id: string; kind: string }[]).find((n) => n.kind === 'invite');
  expect((await api(guest.page, 'POST', `/notifications/${invite?.id}/accept`)).status).toBeLessThan(300);
  await host.page.goto(`/app/trips/${trip.id}`);
  const feed = host.page.getByTestId('trip-activity-feed');
  await expect(feed).toContainText('accepted your invitation');
  await expect(feed).not.toContainText(`You invited ${guest.name}`);
  for (const p of [host, guest]) await p.page.context().close();
});

test('feed photos are a fixed shape and open full size', async ({ browser }) => {
  const me = await person(browser, 'Poster');
  const page = me.page;
  await page.goto('/app/feed');
  await page.getByTestId('feed-create-post').click();
  await page.getByTestId('create-post-file-input').setInputFiles(RECEIPT);
  await expect(page.getByTestId('create-post-photos').locator('img')).toHaveCount(1);
  await page.getByTestId('create-post-caption').fill(`Sunset ${stamp}`);
  await page.getByTestId('create-post-publish').click();
  await expect(page.getByTestId('create-post-dialog')).toHaveCount(0);
  const photo = page.locator('img[data-testid^="post-photo-"]').first();
  const box = await photo.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(Math.min(560, 900 * 0.7) + 1);
  await page.locator('[data-testid^="post-image-open-"]').first().click();
  await expect(page.locator('[data-testid^="post-image-viewer-"]')).toBeVisible();
  await page.context().close();
});

test('on a phone: wizard steps are named, no + on Create trip, and header extras sit in the menu', async ({ browser }) => {
  const me = await person(browser, 'Pocket', { width: 390, height: 844 });
  const page = me.page;
  await page.goto('/app/trips/new');
  await expect(page.getByTestId('create-trip-step-label')).toHaveText('Step 1 of 5 · Basics');
  await expect(page.getByTestId('mobile-nav-create')).toHaveCount(0);
  await page.goto('/app/trips');
  await expect(page.getByTestId('mobile-nav-create')).toBeVisible();
  await expect(page.getByTestId('trips-filter-completed')).toHaveText(/Past/);

  const trip = await newTrip(me, 'Pocket Trip');
  await page.goto(`/app/trips/${trip.id}`);
  await expect(page.getByTestId('trip-invite-button')).toBeVisible();
  await expect(page.getByTestId('trip-edit-button')).toBeHidden();
  await page.getByTestId('trip-more-menu-button').click();
  await page.getByTestId('trip-menu-edit').click();
  await expect(page.getByTestId('edit-trip-name-input')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.context().close();
});

test('your own public trip is labelled in Explore, and opening notifications clears the badge', async ({ browser }) => {
  const host = await person(browser, 'Badge');
  const guest = await person(browser, 'Badger');
  const trip = await newTrip(host, 'Labelled Trip', { visibility: 'public', destination: `Isle ${stamp}` });
  await host.page.goto('/app/explore');
  await host.page.getByTestId('explore-destination').fill(`Isle ${stamp}`);
  await expect(host.page.getByTestId(`public-trip-mine-${trip.id}`)).toHaveText('Your trip');

  expect((await api(host.page, 'POST', `/trips/${trip.id}/members`, { userId: await userId(guest) })).status).toBeLessThan(300);
  await guest.page.goto('/app');
  await expect(guest.page.getByTestId('notifications-unread-count')).toHaveText('1');
  await guest.page.getByTestId('notifications-bell-button').click();
  await expect(guest.page.getByTestId('notifications-panel')).toContainText('Labelled Trip');
  await guest.page.keyboard.press('Escape');
  await expect(guest.page.getByTestId('notifications-unread-count')).toHaveCount(0);
  await guest.page.reload();
  await expect(guest.page.getByTestId('notifications-unread-count')).toHaveCount(0);
  for (const p of [host, guest]) await p.page.context().close();
});
