// UX round 3: accessible form errors, the in-app leave warning, the cover picker, search photos and its
// Explore fallback, activity wording, and layout on the trip page.
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

test('form errors take you to the first problem and are announced to screen readers', async ({ browser }) => {
  const me = await person(browser, 'Keyboard');
  const page = me.page;
  await page.goto('/app/trips/new');
  const name = page.getByTestId('create-trip-name-input');
  await expect(name).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('create-trip-next-button').click();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await name.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText('Give your trip a name (3+ characters)');
  await expect(page.getByTestId('create-trip-destination-input')).toHaveAttribute('aria-invalid', 'true');

  // Fixing the first moves the cursor on to the next problem.
  await name.fill('Backwaters');
  await page.getByTestId('create-trip-next-button').click();
  await expect(page.getByTestId('create-trip-destination-input')).toBeFocused();
  await expect(name).not.toHaveAttribute('aria-invalid', 'true');
  await page.context().close();
});

test('the cover picker is honest about its default and clear about what is chosen', async ({ browser }) => {
  const me = await person(browser, 'Cover');
  const page = me.page;
  await page.goto('/app/trips/new');
  await expect(page.getByTestId('create-trip-basics')).toContainText('A default cover. Choose another or upload your own.');
  await page.getByTestId('create-trip-destination-input').fill('Leh, Ladakh');
  await expect(page.getByTestId('create-trip-basics')).toContainText('Picked to suit Leh, Ladakh.');
  const chosen = page.locator('[data-testid^="create-trip-cover-"][aria-pressed="true"]');
  await expect(chosen).toHaveCount(1);
  await expect(chosen).toHaveClass(/ring-coral/);
  // Nothing washes the chosen photo out; a small tick sits in the corner.
  await expect(chosen.locator('.bg-forest\\/40')).toHaveCount(0);
  await expect(chosen.locator('svg')).toHaveCount(1);
  await page.context().close();
});

test('search shows people with their photos, and offers Explore when nothing matches', async ({ browser }) => {
  test.setTimeout(90_000);
  const me = await person(browser, 'Searcher');
  const pic = await person(browser, 'Pictured');
  await pic.page.goto('/app/settings');
  await pic.page.getByTestId('settings-edit-profile').click();
  await pic.page.getByTestId('profile-avatar-input').setInputFiles(RECEIPT);
  await pic.page.getByTestId('profile-save').click();
  await expect(pic.page.getByTestId('profile-edit-dialog')).toHaveCount(0);

  await me.page.goto('/app');
  const search = me.page.getByTestId('header-search-input');
  await search.fill(pic.username);
  const row = me.page.getByTestId(`search-result-person-${await userId(pic)}`);
  await expect(row.locator('img')).toHaveAttribute('src', /\/api\/files\//);

  const place = `Nowhere${stamp}`;
  await search.fill(place);
  await expect(me.page.getByTestId('search-no-results')).toContainText('Nothing matches');
  await me.page.getByTestId('search-explore-link').click();
  await expect(me.page).toHaveURL(new RegExp(`/app/explore\\?destination=${place}`));
  await expect(me.page.getByTestId('explore-destination')).toHaveValue(place);
  for (const p of [me, pic]) await p.page.context().close();
});

test('approving a request to leave reads clearly in the activity feed', async ({ browser }) => {
  const host = await person(browser, 'Approver');
  const guest = await person(browser, 'Leaver');
  const trip = await newTrip(host, 'Leaving Words Trip');
  expect((await api(guest.page, 'POST', `/invites/${trip.joinCode}/accept`)).status).toBeLessThan(300);
  expect((await api(guest.page, 'POST', `/trips/${trip.id}/leave`, {})).status).toBeLessThan(300);
  const request = ((await api(host.page, 'GET', `/trips/${trip.id}`)).body.leaveRequests as { id: string }[])[0];
  expect((await api(host.page, 'POST', `/trips/${trip.id}/leave-requests/${request.id}/approve`)).status).toBeLessThan(300);
  await host.page.goto(`/app/trips/${trip.id}`);
  const feed = host.page.getByTestId('trip-activity-feed');
  await expect(feed).toContainText(`approved ${guest.name}'s request to leave`);
  await expect(feed).not.toContainText('let ');
  for (const p of [host, guest]) await p.page.context().close();
});

test('the trip page balances its columns and scrolls clear of the phone +', async ({ browser }) => {
  const me = await person(browser, 'Layout', { width: 1440, height: 900 });
  const trip = await newTrip(me, 'Layout Trip');
  await me.page.goto(`/app/trips/${trip.id}`);
  // Activity sits under the main column, so the right column doesn't run on alone.
  const feed = await me.page.getByTestId('trip-activity-feed').boundingBox();
  const members = await me.page.getByTestId('overview-members').boundingBox();
  expect(feed!.x).toBeLessThan(members!.x);

  await me.page.setViewportSize({ width: 390, height: 844 });
  await me.page.goto(`/app/trips/${trip.id}/memories`);
  await expect(me.page.getByTestId('memories-upload-button')).toBeVisible();
  await expect(me.page.getByRole('button', { name: /upload/i })).toHaveCount(1);
  await me.page.goto(`/app/trips/${trip.id}`);
  // The checklist line isn't cut off, and the page ends with room for the + and the bar below it.
  await expect(me.page.getByTestId('getting-started-spend')).toContainText('Tickets, deposits, the first chai');
  const padding = await me.page.getByTestId('trip-back-to-trips').locator('..').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
  expect(padding).toBeGreaterThanOrEqual(96);
  await me.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const plus = await me.page.getByTestId('trip-quick-add').boundingBox();
  const lastCard = await me.page.evaluate(() => Math.max(...[...document.querySelectorAll('main section')].map((s) => s.getBoundingClientRect().bottom)));
  expect(lastCard).toBeLessThanOrEqual(plus!.y);
  await me.page.context().close();
});
