// The new Explore: hosting a public trip, finding it, asking to join, and the host deciding, in real browsers.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const LATEST_RELEASE = /id: "([^"]+)"/.exec(readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'releaseNotes.ts'), 'utf8'))?.[1];
const COVER = 'https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3';
const stamp = Date.now().toString(36);
let counter = 0;

async function verifyToken(email: string) {
  for (let i = 0; i < 50; i++) {
    const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}" subject:"Verify"`)}`)).json();
    if (found.messages?.length) {
      const text = (await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json()).Text as string;
      return text.match(/verify-email\/([\w-]+)/)?.[1] as string;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No verification email for ${email}`);
}

async function traveller(browser: Browser, first: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
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
  await page.goto('/app');
  await page.getByTestId('dashboard-welcome').waitFor();
  return { page, name, email, username };
}

const api = (page: Page, method: string, url: string, body?: unknown) =>
  page.evaluate(async ({ method, url, body }) => {
    const res = await fetch(`/api${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { method, url, body });

test('hosting a public trip, finding it, and joining with the host\'s approval', async ({ browser }) => {
  test.setTimeout(180_000);
  const host = await traveller(browser, 'Hostess');
  const seeker = await traveller(browser, 'Seeker');
  const title = `Spiti Circuit ${stamp}`;
  let id = '';

  await test.step('host a trip from Explore: public is chosen, with a clear warning', async () => {
    await host.page.goto('/app/explore');
    await host.page.getByTestId('explore-host-button').click();
    await host.page.getByTestId('create-trip-name-input').fill(title);
    await host.page.getByTestId('create-trip-destination-input').fill(`Spiti ${stamp}`);
    await host.page.getByTestId('create-trip-description-input').fill('A slow road trip through the high desert');
    await host.page.locator('[data-testid^="create-trip-cover-photo"]').first().click();
    await host.page.getByTestId('create-trip-next-button').click();
    await host.page.getByTestId('create-trip-start-date-input').fill('2031-05-01');
    await host.page.getByTestId('create-trip-end-date-input').fill('2031-05-05');
    await host.page.getByTestId('create-trip-next-button').click();
    await host.page.getByTestId('create-trip-next-button').click();
    await host.page.getByTestId('create-trip-next-button').click();
    await expect(host.page.getByTestId('trip-visibility-public')).toHaveAttribute('aria-checked', 'true');
    await expect(host.page.getByTestId('trip-visibility-warning')).toContainText('can see everything shared');
    await host.page.getByTestId('trip-category').click();
    await host.page.getByRole('option', { name: 'Road trip' }).click();
    await host.page.getByTestId('participant-limit-switch').click();
    await host.page.getByTestId('participant-limit-input').fill('2');
    await host.page.getByTestId('create-trip-submit-button').click();
    await expect(host.page.getByTestId('join-requests-panel')).toBeVisible();
    id = /\/app\/trips\/([^/?]+)/.exec(host.page.url())?.[1] as string;
  });

  await test.step('it appears in Explore with its host, capacity and category', async () => {
    await seeker.page.goto('/app/explore');
    await seeker.page.getByTestId('explore-destination').fill(stamp);
    const card = seeker.page.getByTestId(`public-trip-${id}`);
    await expect(card).toContainText(title);
    await expect(card).toContainText('Road trip');
    await expect(card).toContainText('A slow road trip');
    await expect(seeker.page.getByTestId(`public-trip-capacity-${id}`)).toContainText('1 of 2 joined');
    await expect(seeker.page.getByTestId(`public-trip-host-${id}`)).toContainText(host.name);
    await seeker.page.getByTestId(`public-trip-link-${id}`).click();
    await expect(seeker.page.getByTestId('public-trip-title')).toHaveText(title);
  });

  await test.step('asking to join adds nobody yet', async () => {
    await seeker.page.getByTestId('public-trip-request').click();
    await seeker.page.getByTestId('join-request-message').fill('I have driven this route before');
    await seeker.page.getByTestId('join-request-send').click();
    await expect(seeker.page.getByTestId('public-trip-pending')).toBeVisible();
    expect((await api(seeker.page, 'GET', `/trips/${id}`)).status).toBeGreaterThanOrEqual(403);
  });

  await test.step('the host gets notified, reads the request and accepts', async () => {
    await host.page.getByTestId('notifications-bell-button').click();
    await host.page.getByText(`${seeker.name} asked to join`).click();
    await expect(host.page.getByTestId(`join-request-message-${seeker.username}`)).toHaveText('I have driven this route before');
    await host.page.getByTestId(`join-request-accept-${seeker.username}`).click();
    await expect(host.page.getByTestId('trip-header-capacity')).toHaveText('Trip Full', { timeout: 15_000 });
  });

  await test.step('they\'re in, and the trip now shows as full to everyone else', async () => {
    await seeker.page.reload();
    await seeker.page.getByTestId('public-trip-open').click();
    await expect(seeker.page).toHaveURL(new RegExp(`/app/trips/${id}`));
    await expect(seeker.page.getByTestId('trip-header-name')).toHaveText(title);

    const late = await traveller(browser, 'Late');
    await late.page.goto(`/app/explore/${id}`);
    await expect(late.page.getByTestId('public-trip-full')).toContainText('Trip Full');
    await expect(late.page.getByTestId('public-trip-request')).toHaveCount(0);
    await late.page.context().close();
  });

  await test.step('going private asks first, and removes it from Explore while keeping everyone', async () => {
    await host.page.getByTestId('trip-edit-button').click();
    await host.page.getByTestId('trip-visibility-private').click();
    await host.page.getByTestId('edit-trip-save-button').click();
    await expect(host.page.getByTestId('visibility-confirm')).toContainText('removes it from public discovery');
    await host.page.getByTestId('visibility-confirm-yes').click();
    await expect(host.page.getByTestId('edit-trip-dialog')).toHaveCount(0);
    await seeker.page.goto(`/app/explore/${id}`);
    await expect(seeker.page.getByTestId('public-trip-missing')).toBeVisible();
    await seeker.page.goto(`/app/trips/${id}`);
    await expect(seeker.page.getByTestId('trip-header-name')).toHaveText(title);
  });

  await host.page.context().close();
  await seeker.page.context().close();
});

test('a shared link works signed out, shows nothing private, and leads to signing up', async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await traveller(browser, 'Sharer');
  const id = `trip-${stamp}-${++counter}`;
  const secret = `PRIVATE${stamp}`;
  const made = await api(host.page, 'POST', '/trips', { id, name: 'Shared Link Trek', destination: 'Ladakh', description: 'All welcome', cover: COVER, startDate: '2031-07-01', endDate: '2031-07-03', visibility: 'public', showPlan: true });
  expect(made.status).toBe(201);
  await api(host.page, 'PUT', `/trips/${id}/activities/act-${stamp}`, { day: 0, title: 'Arrive in Leh', start: '10:00', end: '11:00', location: `${secret} hotel`, notes: secret });

  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const visitor = await context.newPage();
  await visitor.goto(`/t/${id}`);
  await expect(visitor.getByTestId('public-trip-title')).toHaveText('Shared Link Trek');
  await expect(visitor.getByTestId('public-trip-plan')).toContainText('Arrive in Leh');
  await expect(visitor.getByTestId('public-trip-page')).not.toContainText(secret);
  await expect(visitor.getByTestId('public-trip-host')).toContainText('Sharer');
  await expect(visitor.getByTestId('public-trip-host')).not.toContainText(stamp);
  await expect(visitor.getByTestId('public-trip-host-link')).toHaveCount(0);
  await expect(visitor.getByTestId('public-trip-safety')).toContainText("doesn't check who people are");
  await visitor.getByTestId('public-trip-signup').click();
  await expect(visitor).toHaveURL(/\/signup/);
  await context.close();
  await host.page.context().close();
});

test('Explore filters trips, offers travellers, and the old recommendations are gone', async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await traveller(browser, 'Filterer');
  const made = async (name: string, category: string, startDate: string, endDate: string) => {
    const id = `trip-${stamp}-${++counter}`;
    expect((await api(host.page, 'POST', '/trips', { id, name, destination: `Coast ${stamp}`, cover: COVER, startDate, endDate, visibility: 'public', category })).status).toBe(201);
    return id;
  };
  // A month that's always on the list, whichever day this runs.
  const inMonths = (n: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + n, 1));
  const iso = (d: Date, day: string) => `${d.toISOString().slice(0, 7)}-${day}`;
  const beach = await made('Beach Week', 'Beach', iso(inMonths(2), '01'), iso(inMonths(2), '07'));
  const trek = await made('Trek Week', 'Trekking', iso(inMonths(3), '01'), iso(inMonths(3), '03'));

  const page = host.page;
  await page.goto('/app/explore');
  await expect(page.getByTestId('explore-host-button')).toBeVisible();
  await expect(page.locator('[data-testid^="explore-save-"]')).toHaveCount(0);
  await page.getByTestId('explore-destination').fill(stamp);
  await expect(page.getByTestId(`public-trip-${beach}`)).toBeVisible();
  await expect(page.getByTestId(`public-trip-${trek}`)).toBeVisible();

  await page.getByTestId('explore-category').click();
  await page.getByRole('option', { name: 'Trekking' }).click();
  await expect(page.getByTestId(`public-trip-${beach}`)).toHaveCount(0);
  await expect(page.getByTestId(`public-trip-${trek}`)).toBeVisible();

  await page.getByTestId('explore-month').click();
  await page.getByRole('option', { name: inMonths(2).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) }).click();
  await expect(page.getByTestId('explore-empty')).toContainText('No trips match');

  await page.getByTestId('explore-tab-travellers').click();
  await expect(page.getByTestId('travellers-list').or(page.getByTestId('travellers-empty'))).toBeVisible();
  await page.goto('/app');
  await page.getByTestId('dashboard-explore-button').click();
  await expect(page).toHaveURL(/\/app\/explore/);
  await host.page.context().close();
});

test('a private trip stays private, and its host sees no join requests', async ({ browser }) => {
  const host = await traveller(browser, 'Private');
  const id = `trip-${stamp}-${++counter}`;
  expect((await api(host.page, 'POST', '/trips', { id, name: 'Family Trip', destination: 'Home', cover: COVER, startDate: '2031-01-01', endDate: '2031-01-02' })).status).toBe(201);
  await host.page.goto(`/app/trips/${id}`);
  await host.page.getByTestId('trip-header-name').waitFor();
  await expect(host.page.getByTestId('join-requests-panel')).toHaveCount(0);
  const context = await browser.newContext();
  const visitor = await context.newPage();
  await visitor.goto(`/t/${id}`);
  await expect(visitor.getByTestId('public-trip-missing')).toBeVisible();
  await context.close();
  await host.page.context().close();
});
