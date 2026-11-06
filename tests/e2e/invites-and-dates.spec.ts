// Inviting travellers by name, from friends and from past trips; trip dates; and the sign-in form.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const LATEST_RELEASE = /id: "([^"]+)"/.exec(readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'releaseNotes.ts'), 'utf8'))?.[1];
const COVER = 'https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3';
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

async function person(browser: Browser, first: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
  return { page, name, username };
}

const api = (page: Page, method: string, url: string, body?: unknown) =>
  page.evaluate(async ({ method, url, body }) => {
    const res = await fetch(`/api${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { method, url, body });


test('the host invites by username, from friends and from past trips, never by searching email', async ({ browser }) => {
  test.setTimeout(150_000);
  const host = await person(browser, 'Host');
  const found = await person(browser, 'Found');
  const friend = await person(browser, 'Friend');
  const mate = await person(browser, 'Mate');

  // A friend, and someone from an earlier trip.
  const req = await api(host.page, 'POST', '/friends/requests', { username: friend.username });
  expect((await api(friend.page, 'POST', `/friends/requests/${req.body.id ?? req.body.requestId}/accept`)).status).toBeLessThan(300);
  const earlier = `trip-${stamp}-${++counter}`;
  const old = await api(host.page, 'POST', '/trips', { id: earlier, name: 'Earlier Trip', destination: 'Goa', cover: COVER, startDate: '2031-01-01', endDate: '2031-01-03' });
  expect((await api(mate.page, 'POST', `/invites/${old.body.joinCode}/accept`)).status).toBeLessThan(300);
  const id = `trip-${stamp}-${++counter}`;
  await api(host.page, 'POST', '/trips', { id, name: 'Picker Trip', destination: 'Goa', cover: COVER, startDate: '2031-02-01', endDate: '2031-02-03' });
  const ids = async (p: typeof host) => (await api(p.page, 'GET', '/state')).body.user.id as string;
  const [foundId, friendId, mateId] = [await ids(found), await ids(friend), await ids(mate)];

  await host.page.goto(`/app/trips/${id}`);
  await host.page.getByTestId('trip-invite-button').click();
  await expect(host.page.getByTestId('invite-section-friends')).toContainText(friend.name);
  await expect(host.page.getByTestId('invite-section-past')).toContainText(mate.name);

  // Email addresses find nobody.
  await host.page.getByTestId('invite-search-input').fill(`${found.username.slice(0, 4)}@example.test`);
  await expect(host.page.getByTestId('invite-no-results')).toBeVisible();
  await host.page.getByTestId('invite-search-input').fill(`@${found.username}`);
  await host.page.getByTestId(`invite-pick-${foundId}`).click();
  await expect(host.page.getByTestId(`invite-person-${foundId}`)).toContainText('Added');
  await host.page.getByTestId('invite-search-input').fill('');
  await host.page.getByTestId(`invite-pick-${friendId}`).click();
  await host.page.getByTestId(`invite-pick-${mateId}`).click();
  await expect(host.page.getByTestId(`invite-person-${mateId}`)).toContainText('Added');
  for (const userId of [foundId, friendId, mateId]) await expect(host.page.getByTestId(`member-row-${userId}`)).toContainText('Invited');

  await found.page.goto('/app');
  await found.page.getByTestId('notifications-bell-button').click();
  await expect(found.page.getByTestId('notifications-panel')).toContainText('Picker Trip');
  for (const p of [host, found, friend, mate]) await p.page.context().close();
});

test('the trip wizard adds travellers by name, has no per-person budget, and keeps the end date after the start', async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await person(browser, 'Planner');
  const pal = await person(browser, 'Pal');
  const palId = (await api(pal.page, 'GET', '/state')).body.user.id as string;
  const page = host.page;
  await page.goto('/app/trips/new');
  await page.getByTestId('create-trip-name-input').fill('Wizard Trip');
  await page.getByTestId('create-trip-destination-input').fill('Kerala');
  await page.locator('[data-testid^="create-trip-cover-photo"]').first().click();
  await page.getByTestId('create-trip-next-button').click();

  const start = page.getByTestId('create-trip-start-date-input');
  const end = page.getByTestId('create-trip-end-date-input');
  await start.fill('2031-05-10');
  await expect(end).toHaveAttribute('min', '2031-05-10');
  await end.fill('2031-05-12');
  await start.fill('2031-05-20');
  await expect(end).toHaveValue('');
  await expect(end).toHaveAttribute('min', '2031-05-20');
  await end.fill('2031-05-22');
  await page.getByTestId('create-trip-next-button').click();

  await page.getByTestId('invite-search-input').fill(pal.username);
  await page.getByTestId(`invite-pick-${palId}`).click();
  await expect(page.getByTestId('create-trip-members')).toContainText(`@${pal.username}`);
  await page.getByTestId('create-trip-next-button').click();
  await expect(page.getByTestId('create-trip-budget')).not.toContainText('Per-person');
  await expect(page.getByTestId('create-trip-per-person-input')).toHaveCount(0);
  await page.getByTestId('create-trip-budget-input').fill('60000');
  await page.getByTestId('create-trip-next-button').click();
  await page.getByTestId('create-trip-submit-button').click();
  await expect(page.getByTestId('trip-header-name')).toHaveText('Wizard Trip');

  await page.getByTestId('trip-invite-button').click();
  await expect(page.getByTestId(`member-row-${palId}`)).toContainText('Invited');
  await page.keyboard.press('Escape');
  await page.getByTestId('trip-tab-expenses').click();
  await expect(page.getByTestId('expenses-stat-budget')).not.toContainText('per person');

  // Editing the dates follows the same rule.
  await page.getByTestId('trip-edit-button').click();
  await page.getByTestId('edit-trip-start-input').fill('2031-06-01');
  await expect(page.getByTestId('edit-trip-end-input')).toHaveValue('2031-06-01');
  await expect(page.getByTestId('edit-trip-end-input')).toHaveAttribute('min', '2031-06-01');
  for (const p of [host, pal]) await p.page.context().close();
});

test('the sign-in password box has no placeholder', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('#login-password')).not.toHaveAttribute('placeholder', /./);
});
