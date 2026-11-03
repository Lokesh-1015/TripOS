// The "What's new" popup: once per person, on any device, and never for someone who has just joined.
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';

const stamp = Date.now().toString(36);
let counter = 0;

/** Someone who was already using TripOS before the release: they've finished onboarding and seen nothing. */
async function existingUser(context: BrowserContext) {
  const email = `whatsnew-${stamp}-${++counter}@example.test`;
  const signup = await context.request.post('/api/auth/signup', { data: { name: 'Existing Tester', email, password: 'correct-horse' } });
  expect(signup.status()).toBeLessThan(300);
  expect((await context.request.patch('/api/me', { data: { onboarded: true } })).status()).toBe(200);
  return email;
}

const newContext = (browser: Browser, viewport = { width: 1440, height: 900 }) => browser.newContext({ viewport });

test('an existing user sees it once, and not again on another device', async ({ browser }) => {
  const context = await newContext(browser);
  const email = await existingUser(context);
  const page = await context.newPage();
  await page.goto('/app');
  const dialog = page.getByTestId('whats-new-dialog');

  await test.step('it opens by itself and covers new features, improvements and fixes', async () => {
    await expect(dialog).toContainText('What\'s new in TripOS');
    // It opens at the top, so nobody misses the new features.
    await expect(page.getByTestId('whats-new-features').getByText('Real emails')).toBeInViewport();
    await expect(page.getByTestId('whats-new-close')).toBeInViewport();
    expect(await page.getByTestId('whats-new-body').evaluate((el) => el.scrollTop)).toBe(0);
    for (const feature of ['Real emails', 'Reminders', 'Real maps', 'Live location', 'Install it', 'Automatic exchange rates', 'Totals across currencies', 'Start a trip from another', 'Trip Replay follows your days', 'Clash warnings', 'Older chat messages', 'weekly digest']) {
      await expect(page.getByTestId('whats-new-features')).toContainText(feature);
    }
    await expect(page.getByTestId('whats-new-improved')).toContainText('converts every amount');
    await expect(page.getByTestId('whats-new-fixed')).toContainText('wipes what you\'re typing');
  });

  await test.step('dismissing it is remembered after a reload', async () => {
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/me') && r.request().method() === 'PATCH');
    await page.getByTestId('whats-new-close').click();
    await expect(dialog).toHaveCount(0);
    expect((await saved).status()).toBe(200);
    await page.reload();
    await page.getByTestId('dashboard-welcome').waitFor();
    await expect(dialog).toHaveCount(0);
  });

  await test.step('it stays dismissed on another device', async () => {
    const other = await newContext(browser);
    const phone = await other.newPage();
    await phone.goto('/login');
    await phone.getByTestId('login-email-input').fill(email);
    await phone.getByTestId('login-password-input').fill('correct-horse');
    await phone.getByTestId('login-submit-button').click();
    await phone.getByTestId('dashboard-welcome').waitFor();
    await expect(phone.getByTestId('whats-new-dialog')).toHaveCount(0);
    await other.close();
  });

  await test.step('Help & support can open it again, and closing it there changes nothing', async () => {
    await page.getByTestId('sidebar-help-button').click();
    await page.getByTestId('help-whats-new-button').click();
    await expect(dialog).toBeVisible();
    await page.getByTestId('whats-new-close').click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await page.getByTestId('dashboard-welcome').waitFor();
    await expect(dialog).toHaveCount(0);
  });

  await context.close();
});

test('closing it any other way counts too', async ({ browser }) => {
  const context = await newContext(browser);
  await existingUser(context);
  const page = await context.newPage();
  await page.goto('/app');
  await expect(page.getByTestId('whats-new-dialog')).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/me') && r.request().method() === 'PATCH');
  await page.keyboard.press('Escape');
  await saved;
  await page.reload();
  await page.getByTestId('dashboard-welcome').waitFor();
  await expect(page.getByTestId('whats-new-dialog')).toHaveCount(0);
  await context.close();
});

test('someone who has just joined doesn\'t see it, as nothing changed for them', async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto('/signup');
  await page.getByTestId('signup-name-input').fill('Brand New');
  await page.getByTestId('signup-email-input').fill(`whatsnew-new-${stamp}@example.test`);
  await page.getByTestId('signup-password-input').fill('correct-horse');
  await page.getByTestId('signup-submit-button').click();
  await page.getByTestId('onboarding-next-button').click();
  await page.getByTestId('onboarding-finish-button').click();
  await page.getByTestId('dashboard-welcome').waitFor();
  await expect(page.getByTestId('whats-new-dialog')).toHaveCount(0);
  await page.reload();
  await page.getByTestId('dashboard-welcome').waitFor();
  await expect(page.getByTestId('whats-new-dialog')).toHaveCount(0);
  await context.close();
});

test('a later release shows once more', async ({ browser }) => {
  const context = await newContext(browser);
  await existingUser(context);
  // As if this person last saw an earlier release.
  expect((await context.request.patch('/api/me', { data: { seenReleaseNotes: '2020-01-01' } })).status()).toBe(200);
  const page = await context.newPage();
  await page.goto('/app');
  await expect(page.getByTestId('whats-new-dialog')).toBeVisible();
  await context.close();
});

test('it can be read and scrolled on a phone', async ({ browser }) => {
  const context = await newContext(browser, { width: 390, height: 780 });
  await existingUser(context);
  const page = await context.newPage();
  await page.goto('/app');
  const dialog = page.getByTestId('whats-new-dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await page.getByTestId('whats-new-body').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(page.getByTestId('whats-new-body').locator('p').first()).toBeInViewport();
  await expect(page.getByTestId('whats-new-close')).toBeInViewport();
  await page.getByTestId('whats-new-fixed').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('whats-new-fixed')).toBeInViewport();
  await page.getByTestId('whats-new-close').click();
  await expect(dialog).toHaveCount(0);
  await context.close();
});
