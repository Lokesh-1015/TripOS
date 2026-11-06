// Changing a username, and every way of leaving a trip, through the real screens.
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

test('changing a username shows availability, then the next date it can change', async ({ browser }) => {
  test.setTimeout(90_000);
  const taken = await person(browser, 'Taken');
  const me = await person(browser, 'Chooser');
  const wanted = `the.traveller${stamp}`.slice(0, 30);

  await me.page.goto(`/app/u/${me.username}`);
  await me.page.getByTestId('profile-edit-button').click();
  const field = me.page.getByTestId('profile-username-input');
  await field.fill(taken.username.toUpperCase());
  await expect(me.page.getByTestId('username-unavailable')).toHaveText('That username is taken');
  await field.fill('bad..name');
  await expect(me.page.getByTestId('username-unavailable')).toContainText('periods');
  await field.fill(wanted.toUpperCase());
  await expect(me.page.getByTestId('username-available')).toContainText(`@${wanted} is available`);
  await me.page.getByTestId('profile-save').click();
  await expect(me.page).toHaveURL(new RegExp(`/app/u/${wanted.replace(/\./g, '\\.')}$`));
  await expect(me.page.getByTestId('profile-username')).toHaveText(`@${wanted}`);

  await me.page.getByTestId('profile-edit-button').click();
  await expect(me.page.getByTestId('profile-username-input')).toBeDisabled();
  await expect(me.page.getByTestId('username-locked')).toContainText('You can change it again on');

  await taken.page.goto('/app/people');
  await taken.page.getByTestId('people-search-input').fill(`@${wanted}`);
  await expect(taken.page.getByTestId(`traveller-${wanted}`)).toBeVisible();
  for (const p of [me, taken]) await p.page.context().close();
});

test('a member asks to leave, an admin approves, and the member loses access', async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await person(browser, 'Host');
  const member = await person(browser, 'Guest');
  const id = `trip-${stamp}-${++counter}`;
  const trip = await api(owner.page, 'POST', '/trips', { id, name: 'Leaving Trip', destination: 'Goa', cover: COVER, startDate: '2031-01-01', endDate: '2031-01-03' });
  expect((await api(member.page, 'POST', `/invites/${trip.body.joinCode}/accept`)).status).toBeLessThan(300);
  await api(member.page, 'PUT', `/trips/${id}/messages/msg-${stamp}`, { kind: 'text', text: 'Hello everyone' });

  await member.page.goto(`/app/trips/${id}`);
  await member.page.getByTestId('trip-more-menu-button').click();
  await member.page.getByTestId('trip-menu-leave').click();
  await expect(member.page.getByTestId('leave-dialog')).toContainText('An admin needs to approve this');
  await member.page.getByTestId('leave-ask').click();
  await expect(member.page.getByTestId('leave-pending')).toBeVisible();
  await member.page.keyboard.press('Escape');

  await owner.page.goto(`/app/trips/${id}`);
  await expect(owner.page.getByTestId('leave-requests-notice')).toContainText('asked to leave');
  await owner.page.getByTestId('leave-requests-review').click();
  await expect(owner.page.getByTestId(`leave-request-${member.page.url() && (await api(member.page, 'GET', '/state')).body.user.id}`)).toContainText('Asked to leave');
  await owner.page.locator('[data-testid^="leave-approve-"]').click();
  await expect(owner.page.locator('[data-testid^="leave-request-"]')).toHaveCount(0);
  await owner.page.keyboard.press('Escape');

  await member.page.goto('/app/trips');
  await expect(member.page.getByText('Leaving Trip')).toHaveCount(0);
  await owner.page.getByTestId('trip-tab-chat').click();
  await expect(owner.page.getByText('Hello everyone')).toBeVisible();
  for (const p of [owner, member]) await p.page.context().close();
});

test('the only admin hands the trip over as they leave, and the last person is told what else they can do', async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await person(browser, 'Owner');
  const member = await person(browser, 'Successor');
  const id = `trip-${stamp}-${++counter}`;
  const trip = await api(owner.page, 'POST', '/trips', { id, name: 'Handover Trip', destination: 'Goa', cover: COVER, startDate: '2031-01-01', endDate: '2031-01-03' });
  expect((await api(member.page, 'POST', `/invites/${trip.body.joinCode}/accept`)).status).toBeLessThan(300);

  await owner.page.goto(`/app/trips/${id}`);
  await owner.page.getByTestId('trip-more-menu-button').click();
  await owner.page.getByTestId('trip-menu-leave').click();
  await expect(owner.page.getByTestId('leave-handover')).toBeDisabled();
  await owner.page.getByTestId('leave-successor').click();
  await owner.page.getByRole('option', { name: member.name }).click();
  await owner.page.getByTestId('leave-handover').click();
  await expect(owner.page).toHaveURL(/\/app\/trips$/);

  await member.page.goto(`/app/trips/${id}`);
  await member.page.getByTestId('trip-more-menu-button').click();
  await expect(member.page.getByTestId('trip-menu-delete')).toBeVisible();
  await member.page.getByTestId('trip-menu-leave').click();
  await expect(member.page.getByTestId('leave-only-person')).toContainText('nobody to hand it over to');
  await expect(member.page.getByTestId('leave-delete-instead')).toBeVisible();
  for (const p of [owner, member]) await p.page.context().close();
});
