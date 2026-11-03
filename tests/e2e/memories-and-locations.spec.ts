// Memories by date and shared chat locations, through the real UI, with a second person on the trip.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

const RECEIPT = path.join(__dirname, '..', 'fixtures', 'receipt.png');
const COVER = 'https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3';
// Marks the What's new popup as seen, as these tests aren't about it.
const LATEST_RELEASE = /id: "([^"]+)"/.exec(readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'releaseNotes.ts'), 'utf8'))?.[1];
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

const openTrip = (page: Page, url: string) => page.goto(url);

test('memories are organised by trip date, and shared with the group', async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await person(browser, 'Owner');
  const friend = await person(browser, 'Friend');
  const id = `trip-${stamp}-${++counter}`;
  const trip = await api(owner, 'POST', '/trips', { id, name: 'Manali Adventure', destination: 'Manali', cover: COVER, startDate: '2030-12-12', endDate: '2030-12-15' });
  expect(trip.status).toBe(201);
  expect((await api(friend, 'POST', `/invites/${trip.body.joinCode}/accept`)).status).toBeLessThan(300);
  expect((await api(owner, 'PUT', `/trips/${id}/activities/act-${stamp}-1`, { day: 1, type: 'activity', title: 'Solang Valley', start: '10:00', end: '12:00', location: '', notes: '' })).status).toBeLessThan(300);

  await openTrip(owner, `/app/trips/${id}/memories`);
  await test.step('every date is listed, labelled from the itinerary, including empty ones', async () => {
    await expect(owner.getByTestId('memories-date-0')).toContainText('12 December');
    await expect(owner.getByTestId('memories-date-3')).toContainText('15 December');
    await expect(owner.getByTestId('memories-date-1')).toContainText('Solang Valley');
    await expect(owner.getByTestId('memories-date-count-1')).toHaveText('0 memories');
  });

  await test.step('choosing a date, then adding captioned photos to it', async () => {
    await owner.getByTestId('memories-date-1').click();
    await expect(owner.getByTestId('memories-empty-state')).toContainText('13 December');
    await owner.getByTestId('memories-file-input').setInputFiles([RECEIPT, RECEIPT]);
    await expect(owner.getByTestId('memories-add-dialog')).toContainText('13 Dec');
    await owner.getByTestId('memories-add-caption-0').fill('Snow at last');
    await owner.getByTestId('memories-add-activity').click();
    await owner.getByRole('option', { name: 'Solang Valley' }).click();
    await owner.getByTestId('memories-add-save').click();
    await expect(owner.locator('[data-testid^="memory-photo-"] img')).toHaveCount(2);
    await expect(owner.getByTestId('memories-date-count-1')).toHaveText('2 memories');
    await expect(owner.getByTestId('memories-day-1')).toContainText('Solang Valley');
    await owner.getByTestId('memories-date-0').click();
    await expect(owner.locator('[data-testid^="memory-photo-"]')).toHaveCount(0);
  });

  await test.step('another member sees them on the same date, and adds their own', async () => {
    await openTrip(friend, `/app/trips/${id}/memories`);
    await expect(friend.getByTestId('memories-date-count-1')).toHaveText('2 memories');
    await friend.getByTestId('memories-date-1').click();
    await friend.getByTestId('memories-file-input').setInputFiles(RECEIPT);
    await friend.getByTestId('memories-add-save').click();
    await expect(friend.getByTestId('memories-date-count-1')).toHaveText('3 memories');
    await expect(owner.getByTestId('memories-date-count-1')).toHaveText('3 memories', { timeout: 15_000 });
  });

  await test.step('caption and highlight can be changed by the author, and last', async () => {
    await owner.getByTestId('memories-date-1').click();
    await owner.locator('[data-testid^="memory-photo-"]', { has: owner.locator('img[alt="Snow at last"]') }).click();
    await expect(owner.getByTestId('memory-activity')).toContainText('Solang Valley');
    await owner.getByTestId('memory-caption-input').fill('First snow');
    await owner.getByTestId('memory-highlight-button').click();
    await owner.keyboard.press('Escape');
    await expect(owner.getByTestId('memories-highlights')).toBeVisible();
    await owner.reload();
    await owner.getByTestId('memories-date-1').click();
    await owner.getByTestId('memories-highlights').click();
    await expect(owner.locator('[data-testid^="memory-photo-"] img')).toHaveCount(1);
    await expect(owner.locator('[data-testid^="memory-photo-"] img')).toHaveAttribute('alt', 'First snow');
  });

  await test.step('a photo left outside the trip after its dates change is still there', async () => {
    expect((await api(owner, 'DELETE', `/trips/${id}/activities/act-${stamp}-1`)).status).toBeLessThan(300);
    const current = (await api(owner, 'GET', `/trips/${id}`)).body;
    expect((await api(owner, 'PATCH', `/trips/${id}`, { version: current.version, endDate: '2030-12-12' })).status).toBeLessThan(300);
    await owner.reload();
    await owner.getByTestId('memories-date-other').click();
    await expect(owner.locator('[data-testid^="memory-photo-"] img')).toHaveCount(3);
  });

  await owner.context().close();
  await friend.context().close();
});

test('a shared place opens the right spot in Google Maps, even after it is deleted', async ({ browser }) => {
  test.setTimeout(90_000);
  const owner = await person(browser, 'Sharer');
  const friend = await person(browser, 'Reader');
  const id = `trip-${stamp}-${++counter}`;
  const trip = await api(owner, 'POST', '/trips', { id, name: 'Goa Beach', destination: 'Goa', cover: COVER, startDate: '2030-01-01', endDate: '2030-01-03' });
  expect((await api(friend, 'POST', `/invites/${trip.body.joinCode}/accept`)).status).toBeLessThan(300);
  const placeId = `place-${stamp}-${++counter}`;
  expect((await api(owner, 'PUT', `/trips/${id}/places/${placeId}`, { name: 'Taj Exotica', type: 'stay', address: 'Benaulim, Goa', note: '', lat: 15.2518, lng: 73.9282 })).status).toBeLessThan(300);

  await openTrip(owner, `/app/trips/${id}/chat`);
  await owner.getByTestId('chat-location-button').click();
  await owner.getByRole('button', { name: 'Taj Exotica' }).click();

  await openTrip(friend, `/app/trips/${id}/chat`);
  const link = friend.locator('[data-testid^="chat-location-open-"]');
  await expect(link).toHaveText('Open in Google Maps');
  await expect(link).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=15.2518%2C73.9282');
  await expect(link).toHaveAttribute('target', '_blank');

  await test.step('searching for a place shares it without saving it to the map', async () => {
    await owner.route('**/photon.komoot.io/**', (route) => route.fulfill({ json: { features: [{ geometry: { coordinates: [73.8278, 15.4909] }, properties: { name: 'Panjim Market', city: 'Panaji', country: 'India' } }] } }));
    await owner.getByTestId('chat-location-button').click();
    await owner.getByTestId('chat-location-search').fill('Panjim');
    await owner.getByTestId('chat-location-search-button').click();
    await owner.getByTestId('chat-location-result').click();
    await expect(link).toHaveCount(2, { timeout: 15_000 });
    await expect(link.nth(1)).toHaveAttribute('href', /query=15\.4909%2C73\.8278/);
    expect((await api(owner, 'GET', `/trips/${id}`)).body.places).toHaveLength(1);
  });

  await test.step('it stays in chat history once the saved place is gone', async () => {
    expect((await api(owner, 'DELETE', `/trips/${id}/places/${placeId}`)).status).toBeLessThan(300);
    await friend.reload();
    await expect(friend.locator('[data-testid^="chat-location-"]').first()).toContainText('Taj Exotica');
    await expect(friend.locator('[data-testid^="chat-location-open-"]').first()).toHaveAttribute('href', /15\.2518/);
  });

  await owner.context().close();
  await friend.context().close();
});
