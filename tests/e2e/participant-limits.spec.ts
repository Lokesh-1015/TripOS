// The optional participant limit through the real screens, including what someone sees when a trip is full.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

const LATEST_RELEASE = /id: "([^"]+)"/.exec(readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'releaseNotes.ts'), 'utf8'))?.[1];
const COVER = 'https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3';
const stamp = Date.now().toString(36);
let counter = 0;

async function person(browser: Browser, name: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.goto('/signup');
  await page.getByTestId('signup-name-input').fill(name);
  await page.getByTestId('signup-email-input').fill(`${name.toLowerCase()}-${stamp}-${++counter}@example.test`);
  await page.getByTestId('signup-password-input').fill('correct-horse');
  await page.getByTestId('signup-submit-button').click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.evaluate(async (latest) => {
    await fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ onboarded: true, seenReleaseNotes: latest }) });
  }, LATEST_RELEASE);
  return page;
}

const api = (page: Page, method: string, url: string, body?: unknown) =>
  page.evaluate(async ({ method, url, body }) => {
    const res = await fetch(`/api${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { method, url, body });

test('a host sets a limit while creating a trip, and it shows as the trip fills up', async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await person(browser, 'Host');
  await host.goto('/app/trips/new');
  await host.getByTestId('create-trip-name-input').fill('Small Group Trek');
  await host.getByTestId('create-trip-destination-input').fill('Hampta Pass');
  await host.locator('[data-testid^="create-trip-cover-photo"]').first().click();
  await host.getByTestId('create-trip-next-button').click();
  await host.getByTestId('create-trip-start-date-input').fill('2030-05-01');
  await host.getByTestId('create-trip-end-date-input').fill('2030-05-05');
  await host.getByTestId('create-trip-next-button').click();
  await host.getByTestId('create-trip-next-button').click();
  await host.getByTestId('create-trip-next-button').click();

  await test.step('it explains that the number includes the host', async () => {
    await host.getByTestId('participant-limit-switch').click();
    await host.getByTestId('participant-limit-input').fill('0');
    await host.getByTestId('create-trip-submit-button').click();
    await expect(host.getByTestId('participant-limit-error')).toBeVisible();
    await host.getByTestId('participant-limit-input').fill('2');
    await expect(host.getByTestId('participant-limit-hint')).toContainText('you plus 1 more person');
    await host.getByTestId('create-trip-submit-button').click();
    await expect(host.getByTestId('trip-header-capacity')).toHaveText('1 of 2 joined');
  });

  const id = /\/app\/trips\/([^/?]+)/.exec(host.url())?.[1] as string;
  const code = (await api(host, 'GET', `/trips/${id}`)).body.joinCode as string;

  const first = await person(browser, 'First');
  await first.goto(`/join/${code}`);
  await first.getByTestId('join-trip-button').click();
  await expect(first).toHaveURL(new RegExp(`/app/trips/${id}`));
  await expect(host.getByTestId('trip-header-capacity')).toHaveText('Trip Full', { timeout: 15_000 });

  await test.step('someone else with the link sees Trip Full and can\'t join', async () => {
    const late = await person(browser, 'Late');
    await late.goto(`/join/${code}`);
    await expect(late.getByTestId('join-trip-full')).toContainText('Trip Full');
    await expect(late.getByTestId('join-trip-button')).toHaveCount(0);
    await late.context().close();
  });

  await test.step('the host can\'t invite more, and can\'t set the limit too low', async () => {
    await host.getByTestId('trip-invite-button').click();
    await expect(host.getByTestId('members-full-note')).toBeVisible();
    await host.keyboard.press('Escape');
    await host.locator('[data-testid="trip-edit-button"], [aria-label="Edit trip"]').first().click();
    await host.getByTestId('participant-limit-input').fill('1');
    await host.getByTestId('edit-trip-save-button').click();
    await expect(host.getByTestId('participant-limit-error')).toContainText("can't be lower");
  });

  await test.step('raising the limit makes room again', async () => {
    await host.getByTestId('participant-limit-input').fill('3');
    await host.getByTestId('edit-trip-save-button').click();
    await expect(host.getByTestId('trip-header-capacity')).toHaveText('2 of 3 joined');
    const next = await person(browser, 'Next');
    await next.goto(`/join/${code}`);
    await next.getByTestId('join-trip-button').click();
    await expect(next).toHaveURL(new RegExp(`/app/trips/${id}`));
    await next.context().close();
  });

  await host.context().close();
  await first.context().close();
});

test('a trip with no limit shows nothing new', async ({ browser }) => {
  const host = await person(browser, 'Plain');
  const id = `trip-${stamp}-${++counter}`;
  expect((await api(host, 'POST', '/trips', { id, name: 'No Limit Trip', destination: 'Goa', cover: COVER, startDate: '2030-01-01', endDate: '2030-01-03' })).status).toBe(201);
  await host.goto(`/app/trips/${id}`);
  await host.getByTestId('trip-header-name').waitFor();
  await expect(host.getByTestId('trip-header-capacity')).toHaveCount(0);
  await host.context().close();
});
