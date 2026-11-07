// Every remaining screen through the real UI: each change must still be there after a reload.
import path from 'node:path';
import { expect, test } from '@playwright/test';

const stamp = Date.now().toString(36);
const RECEIPT = path.join(__dirname, '..', 'fixtures', 'receipt.png');

test('itinerary, packing, documents, map, memories, settings and hubs all persist', async ({ browser }) => {
  // This walks through nearly every screen, so it needs longer than the default.
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  // An empty map style, so this doesn't depend on the tile service. maps-and-live-location.spec.ts covers the map.
  await page.route('**/tiles.openfreemap.org/**', (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.route('**/photon.komoot.io/**', (route) => route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { features: [] } }));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/images\.unsplash|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  const email = `screens-${stamp}@example.test`;
  const password = 'correct-horse';

  await page.goto('/signup');
  await page.getByTestId('signup-name-input').fill('Screen Tester');
  await page.getByTestId('signup-email-input').fill(email);
  await page.getByTestId('signup-password-input').fill(password);
  await page.getByTestId('signup-submit-button').click();
  await page.getByTestId('onboarding-next-button').click();
  await page.getByTestId('onboarding-finish-button').click();
  await page.getByTestId('onboarding-friends-skip').click();

  // Inviting by email needs a verified address.
  let verifyLink = '';
  for (let i = 0; i < 50 && !verifyLink; i++) {
    const found = await (await fetch(`http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    if (found.messages?.length) verifyLink = (await (await fetch(`http://localhost:8025/api/v1/message/${found.messages[0].ID}`)).json()).Text.match(/http:\/\/localhost:3000\/verify-email\/[\w-]+/)[0];
    else await page.waitForTimeout(100);
  }
  await page.goto(verifyLink);
  await page.getByTestId('verify-email-done').waitFor();

  await page.goto('/app/trips/new');
  await page.getByTestId('create-trip-name-input').fill('Everything Trip');
  await page.getByTestId('create-trip-destination-input').fill('Kerala');
  await page.locator('[data-testid^="create-trip-cover-photo"]').first().click();
  await page.getByTestId('create-trip-next-button').click();
  await page.getByTestId('create-trip-start-date-input').fill('2030-05-01');
  await page.getByTestId('create-trip-end-date-input').fill('2030-05-03');
  await page.getByTestId('create-trip-next-button').click();
  await page.getByTestId('create-trip-invite-email-input').fill(`friend-${stamp}@example.test`);
  await page.getByTestId('create-trip-invite-add-button').click();
  await page.getByTestId('create-trip-next-button').click();
  await page.getByTestId('create-trip-next-button').click();
  await page.getByTestId('create-trip-submit-button').click();
  await expect(page.getByTestId('trip-header-name')).toHaveText('Everything Trip');
  const tripUrl = page.url();

  await test.step('an emailed invitee shows as pending', async () => {
    await page.getByTestId('trip-invite-button').click();
    await page.getByTestId('members-tab-members').click();
    await expect(page.getByTestId('members-dialog')).toContainText('Invited');
    await page.keyboard.press('Escape');
  });

  await test.step('itinerary: add, comment, attach, reorder', async () => {
    await page.goto(`${tripUrl}/itinerary`);
    for (const title of ['Morning hike', 'Lunch stop']) {
      await page.getByTestId('itinerary-add-activity-button').click();
      await page.getByTestId('activity-title-input').fill(title);
      await page.getByTestId('activity-save-button').click();
      await expect(page.getByTestId('itinerary-timeline')).toContainText(title);
    }
    // By title, because another card can mention this one when their times overlap.
    const hike = page.locator('[data-testid^="activity-card-"]', { has: page.getByRole('heading', { name: 'Morning hike' }) });
    await hike.locator('[data-testid^="activity-toggle-details-"]').click();
    await hike.locator('[data-testid^="activity-comment-input-"]').fill('Bring water');
    await hike.locator('[data-testid^="activity-comment-send-"]').click();
    await expect(hike).toContainText('Bring water');
    await hike.locator('[data-testid^="activity-attach-"] input').setInputFiles(RECEIPT);
    await expect(hike).toContainText('receipt.png');
    await hike.locator('[data-testid^="activity-move-down-"]').click();
    await expect(page.locator('[data-testid^="activity-card-"]').first().getByRole('heading')).toHaveText('Lunch stop');
    await page.reload();
    await expect(page.locator('[data-testid^="activity-card-"]').first().getByRole('heading')).toHaveText('Lunch stop');
    const reloaded = page.locator('[data-testid^="activity-card-"]', { has: page.getByRole('heading', { name: 'Morning hike' }) });
    await reloaded.locator('[data-testid^="activity-toggle-details-"]').click();
    await expect(reloaded).toContainText('Bring water');
    await expect(reloaded).toContainText('receipt.png');
  });

  await test.step('packing: personal and shared lists, ticking off, templates', async () => {
    await page.goto(`${tripUrl}/packing`);
    await page.getByTestId('packing-item-name-input').fill('Rain jacket');
    await page.getByTestId('packing-add-button').click();
    await page.getByRole('button', { name: 'Pack Rain jacket' }).click();
    await expect(page.getByTestId('packing-progress-label')).toHaveText('1/1 packed');
    await page.getByTestId('packing-templates-button').click();
    await page.getByTestId('packing-template-apply-beach').click();
    await expect(page.getByRole('button', { name: 'Pack Swimwear' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Unpack Rain jacket' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pack Swimwear' })).toBeVisible();
  });

  await test.step('documents: a real file uploads, previews and survives a reload', async () => {
    await page.goto(`${tripUrl}/documents`);
    await page.getByTestId('documents-file-input').setInputFiles(RECEIPT);
    await page.getByTestId('document-upload-name-input').fill('Hotel booking');
    const uploaded = page.waitForResponse((r) => r.url().includes('/api/files') && r.request().method() === 'POST');
    await page.getByTestId('document-upload-save-button').click();
    expect((await uploaded).status()).toBe(201);
    await expect(page.getByTestId('documents-list')).toContainText('Hotel booking');
    await page.reload();
    await expect(page.getByTestId('documents-list')).toContainText('Hotel booking');
    await page.locator('[data-testid^="document-preview-"]').first().click();
    const image = page.getByTestId('document-preview-dialog').locator('img');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
  });

  await test.step('map: a saved place persists', async () => {
    await page.goto(`${tripUrl}/map`);
    await page.getByTestId('map-add-place-button').click();
    await expect(page.getByTestId('trip-map')).toHaveAttribute('data-map-ready', 'true', { timeout: 30_000 });
    await page.getByTestId('trip-map').click({ position: { x: 200, y: 200 } });
    await page.getByTestId('place-name-input').fill('Houseboat jetty');
    await page.getByTestId('place-save-button').click();
    await expect(page.getByTestId('map-places-list')).toContainText('Houseboat jetty');
    await page.reload();
    await expect(page.getByTestId('map-places-list')).toContainText('Houseboat jetty');
  });

  await test.step('memories: an uploaded photo displays and survives a reload', async () => {
    await page.goto(`${tripUrl}/memories`);
    await page.getByTestId('memories-file-input').setInputFiles(RECEIPT);
    const photo = page.locator('[data-testid^="memory-photo-"] img');
    await expect(photo).toBeVisible();
    await page.reload();
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  });

  await test.step('chat: a shared image displays', async () => {
    await page.goto(`${tripUrl}/chat`);
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(RECEIPT);
    const shared = page.getByTestId('chat-messages').locator('img[alt="Shared"]');
    await expect(shared).toBeVisible();
    await expect.poll(() => shared.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  });

  await test.step('the activity feed reflects what happened, written by the server', async () => {
    await page.goto(tripUrl);
    await expect(page.getByTestId('trip-activity-feed')).toContainText('added a photo to Memories');
  });

  await test.step('trip edit and archive persist', async () => {
    await page.getByTestId('trip-edit-button').click();
    await page.getByTestId('edit-trip-name-input').fill('Everything Trip Renamed');
    await page.getByTestId('edit-trip-save-button').click();
    await page.locator('[data-sonner-toast]', { hasText: 'Trip details saved' }).waitFor();
    await page.reload();
    await expect(page.getByTestId('trip-header-name')).toHaveText('Everything Trip Renamed');
    await page.getByTestId('trip-more-menu-button').click();
    await page.getByTestId('trip-menu-archive').click();
    await page.goto('/app/trips?status=archived');
    await expect(page.getByTestId('trips-grid')).toContainText('Everything Trip Renamed');
    await page.goto(tripUrl);
    await page.getByTestId('trip-more-menu-button').click();
    await page.getByTestId('trip-menu-archive').click();
    await expect(page.getByTestId('trip-menu-archive')).toHaveCount(0);
  });

  await test.step('cross-trip hubs read the same data', async () => {
    await page.goto('/app/documents');
    await expect(page.getByTestId('hub-documents-list')).toContainText('Hotel booking');
    await page.goto('/app/memories');
    await expect(page.locator('[data-testid^="hub-memories-trip-"]').first()).toContainText('Everything Trip Renamed');
  });

  await test.step('explore: opens, and offers hosting a trip', async () => {
    await page.goto('/app/explore');
    await expect(page.getByTestId('explore-host-button')).toBeVisible();
    await page.getByTestId('explore-tab-travellers').click();
    await expect(page.getByTestId('travellers-list').or(page.getByTestId('travellers-empty'))).toBeVisible();
  });

  await test.step('settings: profile, notifications and password persist', async () => {
    // The profile is edited in one place: Settings opens the profile page's editor.
    await page.goto('/app/settings');
    await page.getByTestId('settings-edit-profile').click();
    await page.getByTestId('profile-bio-input').fill('Always hungry');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('profile-edit-dialog')).toHaveCount(0);
    await page.goto('/app/settings');
    await page.getByTestId('settings-tab-notifications').click();
    await page.getByTestId('settings-notify-itinerary').click();
    await page.reload();
    await page.getByTestId('settings-edit-profile').click();
    await expect(page.getByTestId('profile-bio-input')).toHaveValue('Always hungry');
    await page.goto('/app/settings');
    await page.getByTestId('settings-tab-notifications').click();
    await expect(page.getByTestId('settings-notify-itinerary')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('settings-tab-account').click();
    await page.getByTestId('settings-password-current-input').fill(password);
    await page.getByTestId('settings-password-new-input').fill('a-brand-new-password');
    await page.getByTestId('settings-password-save-button').click();
    await expect(page.getByText('Password changed')).toBeVisible();
    await page.getByTestId('sidebar-account-menu-button').click();
    await page.getByTestId('account-menu-sign-out').click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByTestId('login-email-input').fill(email);
    await page.getByTestId('login-password-input').fill(password);
    await page.getByTestId('login-submit-button').click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await page.getByTestId('login-password-input').fill('a-brand-new-password');
    await page.getByTestId('login-submit-button').click();
    await expect(page).toHaveURL(/\/app/);
  });

  await test.step('deleting a trip removes it', async () => {
    await page.goto(tripUrl);
    await page.getByTestId('trip-more-menu-button').click();
    await page.getByTestId('trip-menu-delete').click();
    await page.getByRole('button', { name: 'Delete trip' }).click();
    await expect(page).toHaveURL(/\/app\/trips$/);
    await page.reload();
    await expect(page.getByText('Everything Trip Renamed')).toHaveCount(0);
  });

  expect(errors).toEqual([]);
  await context.close();
});
