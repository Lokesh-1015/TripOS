// The UX round: invitations, the members dialog, email changes, trip dates, first steps, undo, phones and setup.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const LATEST_RELEASE = /id: "([^"]+)"/.exec(readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'releaseNotes.ts'), 'utf8'))?.[1];
const COVER = 'https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3';
const RECEIPT = path.join(__dirname, '..', 'fixtures', 'receipt.png');
const stamp = Date.now().toString(36);
let counter = 0;

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

async function mailLink(to: string, subject: string, route: string) {
  for (let i = 0; i < 80; i++) {
    const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`)).json();
    if (found.messages?.length) {
      const text = (await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json()).Text as string;
      return text.match(new RegExp(`${route}/([\\w-]+)`))?.[1] as string;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No "${subject}" email for ${to}`);
}
const verifyToken = (email: string) => mailLink(email, 'Verify', 'verify-email');

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
  return { page, name, email, username };
}

const api = (page: Page, method: string, url: string, body?: unknown) =>
  page.evaluate(async ({ method, url, body }) => {
    const res = await fetch(`/api${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { method, url, body });

const userId = async (p: { page: Page }) => (await api(p.page, 'GET', '/state')).body.user.id as string;
const newTrip = async (p: { page: Page }, name: string) => {
  const id = `trip-${stamp}-${++counter}`;
  await api(p.page, 'POST', '/trips', { id, name, destination: 'Goa', cover: COVER, startDate: '2031-01-01', endDate: '2031-01-03' });
  return id;
};

test('invitations wait at the top of My Trips, each with Accept and Decline', async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await person(browser, 'Inviter');
  const guest = await person(browser, 'Invitee');
  const guestId = await userId(guest);
  const first = await newTrip(host, 'Accept Me Trip');
  const second = await newTrip(host, 'Decline Me Trip');
  for (const t of [first, second]) expect((await api(host.page, 'POST', `/trips/${t}/members`, { userId: guestId })).status).toBeLessThan(300);

  await guest.page.goto('/app/trips');
  const list = guest.page.getByTestId('trips-invitations');
  await expect(list).toContainText('2 trip invitations');
  await expect(list).toContainText('Accept Me Trip');
  await list.locator('[data-testid^="invitation-"]', { hasText: 'Decline Me Trip' }).getByTestId('trips-invite-decline').click();
  await expect(list).not.toContainText('Decline Me Trip');
  await list.getByTestId('trips-invite-accept').click();
  await expect(guest.page).toHaveURL(new RegExp(`/app/trips/${first}$`));
  await guest.page.goto('/app/trips');
  await expect(guest.page.getByTestId('trips-invitations')).toHaveCount(0);
  await expect(guest.page.getByText('Accept Me Trip').first()).toBeVisible();
  for (const p of [host, guest]) await p.page.context().close();
});

test('the members dialog has Invite and Members tabs, opened on the right one', async ({ browser }) => {
  const host = await person(browser, 'Tabber');
  const id = await newTrip(host, 'Tabs Trip');
  await host.page.goto(`/app/trips/${id}`);
  await host.page.getByTestId('trip-invite-button').click();
  await expect(host.page.getByTestId('members-tab-invite')).toHaveAttribute('aria-selected', 'true');
  await expect(host.page.getByTestId('invite-search-input')).toBeVisible();
  await expect(host.page.getByTestId('members-copy-link-button')).toBeVisible();
  await expect(host.page.locator('[data-testid^="member-row-"]')).toHaveCount(0);
  await host.page.getByTestId('members-tab-members').click();
  await expect(host.page.locator('[data-testid^="member-row-"]')).toHaveCount(1);
  await expect(host.page.getByTestId('invite-search-input')).toHaveCount(0);
  await host.page.keyboard.press('Escape');
  await host.page.getByTestId('trip-header-members-button').click();
  await expect(host.page.getByTestId('members-tab-members')).toHaveAttribute('aria-selected', 'true');
  await host.page.context().close();
});

test('a new email waits for its link, and a typo can be cancelled', async ({ browser }) => {
  test.setTimeout(90_000);
  const me = await person(browser, 'Mover');
  const page = me.page;
  await page.goto('/app/settings');
  await expect(page.getByTestId('settings-current-email')).toHaveText(me.email);

  const typo = `typo-${stamp}@example.test`;
  await page.getByTestId('settings-email-input').fill(typo);
  await page.getByTestId('settings-email-save').click();
  await expect(page.getByTestId('settings-email-pending')).toContainText(typo);
  await expect(page.getByTestId('settings-current-email')).toHaveText(me.email);
  await page.getByTestId('settings-email-cancel').click();
  await expect(page.getByTestId('settings-email-pending')).toHaveCount(0);

  const next = `moved-${stamp}@example.test`;
  await page.getByTestId('settings-email-input').fill(next);
  await page.getByTestId('settings-email-save').click();
  await expect(page.getByTestId('settings-email-pending')).toContainText(next);
  const token = await mailLink(next, 'Confirm your new TripOS email', 'verify-email');
  await page.goto(`/verify-email/${token}`);
  await page.getByTestId('verify-email-done').waitFor();
  await page.goto('/app/settings');
  await expect(page.getByTestId('settings-current-email')).toHaveText(next);
  await expect(page.getByTestId('settings-email-pending')).toHaveCount(0);
  await page.context().close();
});

test('trip dates are picked on one calendar that shows the length', async ({ browser }) => {
  const me = await person(browser, 'Calendar');
  const page = me.page;
  await page.goto('/app/trips/new');
  await page.getByTestId('create-trip-name-input').fill('Calendar Trip');
  await page.getByTestId('create-trip-destination-input').fill('Kerala');
  await page.locator('[data-testid^="create-trip-cover-photo"]').first().click();
  await page.getByTestId('create-trip-next-button').click();
  await expect(page.getByTestId('date-range-summary')).toHaveText('Choose the start date');
  const start = daysFromNow(10);
  const end = daysFromNow(12);
  await page.locator(`[data-day="${iso(start)}"] button`).click();
  await expect(page.getByTestId('date-range-summary')).toHaveText('Now choose the end date');
  await page.locator(`[data-day="${iso(end)}"] button`).click();
  await expect(page.getByTestId('date-range-summary')).toHaveText('3 days · 2 nights');
  await expect(page.getByTestId('create-trip-start-date-input')).toHaveValue(iso(start));
  await expect(page.getByTestId('create-trip-end-date-input')).toHaveValue(iso(end));
  // Days before today can't be chosen.
  await expect(page.locator(`[data-day="${iso(daysFromNow(-1))}"] button`)).toBeDisabled();
  await page.context().close();
});

test('a new trip lists its first steps, ticks them off, and can hide them', async ({ browser }) => {
  const me = await person(browser, 'Starter');
  const id = await newTrip(me, 'Starter Trip');
  await me.page.goto(`/app/trips/${id}`);
  const steps = me.page.getByTestId('getting-started');
  await expect(steps).toContainText('0 of 4 done');
  await expect(me.page.getByTestId('getting-started-plan')).toHaveAttribute('data-done', 'false');
  expect((await api(me.page, 'PUT', `/trips/${id}/activities/act-${stamp}`, { day: 0, title: 'Beach walk', start: '09:00', end: '10:00' })).status).toBeLessThan(300);
  await me.page.reload();
  await expect(me.page.getByTestId('getting-started-plan')).toHaveAttribute('data-done', 'true');
  await expect(steps).toContainText('1 of 4 done');
  await me.page.getByTestId('getting-started-invite').getByRole('button').click();
  await expect(me.page.getByTestId('members-tab-invite')).toHaveAttribute('aria-selected', 'true');
  await me.page.keyboard.press('Escape');
  await me.page.getByTestId('getting-started-hide').click();
  await expect(steps).toHaveCount(0);
  await me.page.reload();
  await expect(me.page.getByTestId('trip-header-name')).toBeVisible();
  await expect(me.page.getByTestId('getting-started')).toHaveCount(0);
  await me.page.context().close();
});

test('deleting an expense can be undone, and only reaches the server once Undo has passed', async ({ browser }) => {
  test.setTimeout(60_000);
  const me = await person(browser, 'Undoer');
  const id = await newTrip(me, 'Undo Trip');
  const meId = await userId(me);
  const exp = `exp-${stamp}`;
  expect((await api(me.page, 'PUT', `/trips/${id}/expenses/${exp}`, { title: 'Ferry tickets', amount: 600, category: 'transport', paidBy: meId, date: '2031-01-01', splitType: 'equal', shares: [{ memberId: meId, amount: 600 }] })).status).toBeLessThan(300);
  const onServer = async () => ((await api(me.page, 'GET', `/trips/${id}`)).body.expenses as { id: string }[]).some((e) => e.id === exp);
  await me.page.goto(`/app/trips/${id}/expenses`);
  await me.page.getByTestId(`expense-delete-${exp}`).click();
  await expect(me.page.getByTestId(`expense-row-${exp}`)).toHaveCount(0);
  await me.page.getByRole('button', { name: 'Undo' }).click();
  await expect(me.page.getByTestId(`expense-row-${exp}`)).toBeVisible();
  await me.page.waitForTimeout(5500);
  expect(await onServer()).toBe(true);

  await me.page.getByTestId(`expense-delete-${exp}`).click();
  await expect(me.page.getByTestId(`expense-row-${exp}`)).toHaveCount(0);
  expect(await onServer()).toBe(true);
  await expect.poll(onServer, { timeout: 10_000 }).toBe(false);
  await me.page.reload();
  await expect(me.page.getByTestId(`expense-row-${exp}`)).toHaveCount(0);
  await me.page.context().close();
});

test('on a phone, a trip has its own bottom bar and a + for the most common thing to add', async ({ browser }) => {
  const me = await person(browser, 'Phone');
  const id = await newTrip(me, 'Phone Trip');
  await me.page.setViewportSize({ width: 390, height: 844 });
  await me.page.goto(`/app/trips/${id}`);
  await expect(me.page.getByTestId('trip-mobile-bar')).toBeVisible();
  await expect(me.page.getByTestId('trip-tabs')).toBeHidden();
  await expect(me.page.getByTestId('mobile-bottom-nav')).toHaveCount(0);
  await me.page.getByTestId('trip-quick-add').click();
  await expect(me.page).toHaveURL(new RegExp(`/app/trips/${id}/expenses`));
  await expect(me.page.getByTestId('expense-dialog')).toBeVisible();
  await me.page.keyboard.press('Escape');
  await expect(me.page.getByTestId('expense-dialog')).toHaveCount(0);
  await me.page.getByTestId('trip-mobile-itinerary').click();
  await expect(me.page).toHaveURL(new RegExp(`/app/trips/${id}/itinerary$`));
  await expect(me.page.getByTestId('trip-quick-add')).toHaveAttribute('aria-label', 'Add activity');
  await me.page.getByTestId('trip-quick-add').click();
  await expect(me.page.getByTestId('activity-title-input')).toBeVisible();
  await me.page.keyboard.press('Escape');
  await me.page.getByTestId('trip-mobile-more').click();
  await me.page.getByTestId('trip-mobile-more-tasks').click();
  await expect(me.page).toHaveURL(new RegExp(`/app/trips/${id}/tasks`));
  const overflow = await me.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await me.page.goto('/app/trips');
  await expect(me.page.getByTestId('mobile-bottom-nav')).toBeVisible();
  await me.page.context().close();
});

test('setup takes a photo and ends with finding friends, which can be skipped', async ({ browser }) => {
  test.setTimeout(90_000);
  const friend = await person(browser, 'Findable');
  const friendId = await userId(friend);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const email = `setup-${stamp}-${++counter}@example.test`;
  await page.goto('/signup');
  await page.getByTestId('signup-name-input').fill(`Newbie ${stamp}`);
  await page.getByTestId('signup-email-input').fill(email);
  await page.getByTestId('signup-password-input').fill('correct-horse');
  await page.getByTestId('signup-submit-button').click();
  await expect(page).toHaveURL(/\/onboarding/);
  const token = await verifyToken(email);
  await page.evaluate(async (t) => { await fetch('/api/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) }); }, token);
  await page.reload();
  await page.getByTestId('onboarding-photo-input').setInputFiles(RECEIPT);
  await expect(page.getByTestId('onboarding-photo')).toContainText('Change photo');
  await expect(page.getByTestId('onboarding-username-input')).not.toHaveValue('');
  await page.getByTestId('onboarding-next-button').click();
  await page.getByTestId('onboarding-finish-button').click();
  await expect(page.getByTestId('onboarding-step-friends')).toBeVisible();
  await page.getByTestId('find-friends-search').fill(friend.username);
  const row = page.getByTestId(`find-friends-person-${friendId}`);
  await row.getByTestId('friend-state-add').click();
  await expect(row.getByTestId('friend-state-sent')).toBeVisible();
  await page.getByTestId('onboarding-friends-done').click();
  await expect(page).toHaveURL(/\/app/);
  const avatar = (await api(page, 'GET', '/state')).body.user.avatar as string;
  expect(avatar).toMatch(/\/api\/files\//);
  await context.close();
  await friend.page.context().close();
});
