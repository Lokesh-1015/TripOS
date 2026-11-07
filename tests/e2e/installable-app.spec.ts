// The installable app and offline access. Service workers only run in a built app, so this needs
// `yarn build && yarn preview --port 3001` in frontend/ and PREVIEW_URL=http://localhost:3001.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const BASE = process.env.PREVIEW_URL;
const RECEIPT = path.join(__dirname, '..', 'fixtures', 'receipt.png');
const COVER = 'https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3';
const stamp = Date.now().toString(36);

test.skip(!BASE, 'Set PREVIEW_URL to the built frontend to run these');
test.use({ baseURL: BASE });

/** What's saved on the device, read directly so the test sees what a thief or the next user could. */
const deviceCopy = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open('tripos-offline', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('snapshots');
        open.onsuccess = () => {
          const get = open.result.transaction('snapshots').objectStore('snapshots').get('state');
          get.onsuccess = () => {
            open.result.close();
            resolve(get.result ? JSON.stringify(get.result) : null);
          };
        };
      }),
  );

test('the app can be installed: it has a valid manifest and icons', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'TripOS', start_url: '/app', display: 'standalone' });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) {
    const res = await request.get(icon.src);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  }
});

test('a trip opens with no signal, without keeping documents on the device, until sign-out wipes it', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('/signup');
  await page.getByTestId('signup-name-input').fill('Offline Tester');
  await page.getByTestId('signup-email-input').fill(`offline-${stamp}@example.test`);
  await page.getByTestId('signup-password-input').fill('correct-horse');
  await page.getByTestId('signup-submit-button').click();
  await page.getByTestId('onboarding-next-button').click();
  await page.getByTestId('onboarding-finish-button').click();
  await page.getByTestId('onboarding-friends-skip').click();
  await page.getByTestId('dashboard-welcome').waitFor();

  const id = `trip-offline-${stamp}`;
  await page.evaluate(
    async (body) => fetch('/api/trips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    { id, name: 'Offline Trip', destination: 'Ladakh', cover: COVER, startDate: '2030-03-01', endDate: '2030-03-04' },
  );

  await test.step('add an expense and a private passport copy', async () => {
    await page.goto(`/app/trips/${id}/expenses`);
    await page.getByTestId('expenses-add-button').click();
    await page.getByTestId('expense-title-input').fill('Permit fee');
    await page.getByTestId('expense-amount-input').fill('500');
    await page.getByTestId('expense-save-button').click();
    await expect(page.getByTestId('expenses-history')).toContainText('Permit fee');
    await page.goto(`/app/trips/${id}/documents`);
    await page.getByTestId('documents-file-input').setInputFiles(RECEIPT);
    await page.getByTestId('document-upload-name-input').fill('My passport copy');
    await page.getByTestId('document-upload-save-button').click();
    await expect(page.getByTestId('documents-list')).toContainText('My passport copy');
  });

  await test.step('the service worker takes control', async () => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect(page.getByTestId('documents-list')).toContainText('My passport copy');
  });

  await test.step('documents stay out of what\'s saved on the device', async () => {
    await expect.poll(() => deviceCopy(page)).toContain('Permit fee');
    expect(await deviceCopy(page)).not.toContain('My passport copy');
  });

  await context.setOffline(true);

  await test.step('with no signal, the app opens and shows the trip', async () => {
    await page.goto(`/app/trips/${id}/expenses`);
    await expect(page.getByTestId('expenses-history')).toContainText('Permit fee');
    await expect(page.getByTestId('offline-banner')).toContainText('last saved on this device');
    await page.goto(`/app/trips/${id}`);
    await expect(page.getByTestId('trip-header-name')).toHaveText('Offline Trip');
  });

  await test.step('documents explain why they\'re missing', async () => {
    await page.goto(`/app/trips/${id}/documents`);
    await expect(page.getByTestId('documents-offline-note')).toBeVisible();
    await expect(page.getByText('My passport copy')).toHaveCount(0);
  });

  await context.setOffline(false);

  await test.step('back online, everything returns by itself', async () => {
    await expect(page.getByText('My passport copy')).toBeVisible();
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);
  });

  await test.step('signing out wipes the copy', async () => {
    await page.getByTestId('sidebar-account-menu-button').click();
    await page.getByTestId('account-menu-sign-out').click();
    await expect(page).toHaveURL(/\/login/);
    expect(await deviceCopy(page)).toBeNull();
  });

  await test.step('with no signal and no copy, the login page still opens, and shows no trip', async () => {
    await context.setOffline(true);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Offline Trip')).toHaveCount(0);
    await context.setOffline(false);
  });

  await context.close();
});

test('the service worker never answers API calls from its cache', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  const failed = await page.evaluate(() => fetch('/api/health').then(() => false, () => true));
  expect(failed).toBe(true);
  await context.close();
});
