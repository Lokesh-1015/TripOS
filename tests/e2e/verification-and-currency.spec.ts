// Email verification, currency conversion and the closed product gaps, through the real UI.
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const RECEIPT = path.join(__dirname, '..', 'fixtures', 'receipt.png');
const COVER = 'https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3';
const stamp = Date.now().toString(36);
let counter = 0;

async function emailText(address: string, subject: string) {
  for (let i = 0; i < 50; i++) {
    const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}" subject:"${subject}"`)}`)).json();
    if (found.messages?.length) return (await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json()).Text as string;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No "${subject}" email for ${address}`);
}

const linkIn = (text: string, route: string) => text.match(new RegExp(`http://localhost:3000/${route}[^\\s]+`))?.[0] as string;

async function fillSignup(page: Page, name: string, email: string) {
  await page.getByTestId('signup-name-input').fill(name);
  await page.getByTestId('signup-email-input').fill(email);
  await page.getByTestId('signup-password-input').fill('correct-horse');
  await page.getByTestId('signup-submit-button').click();
  await page.getByTestId('onboarding-next-button').click();
  await page.getByTestId('onboarding-finish-button').click();
  await page.getByTestId('onboarding-friends-skip').click();
}

async function newUser(browser: Browser, first: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const email = `${first.toLowerCase()}-${stamp}-${++counter}@example.test`;
  await page.goto('/signup');
  await fillSignup(page, `${first} Tester`, email);
  await page.getByTestId('dashboard-welcome').waitFor();
  return { page, context, email };
}

async function verify(page: Page, email: string) {
  await page.goto(linkIn(await emailText(email, 'Verify your TripOS email'), 'verify-email'));
  await page.getByTestId('verify-email-done').waitFor();
}

const api = (page: Page, method: string, url: string, body?: unknown) =>
  page.evaluate(
    async ([m, u, b]) => {
      const r = await fetch(`/api${u}`, { method: m as string, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [method, url, body] as const,
  );

async function trip(page: Page, over: Record<string, unknown> = {}) {
  const id = `trip-${stamp}-${++counter}`;
  const made = await api(page, 'POST', '/trips', { id, name: 'Test Trip', destination: 'Goa', cover: COVER, startDate: '2030-03-01', endDate: '2030-03-04', ...over });
  expect(made.status).toBe(201);
  return { id, joinCode: made.body.joinCode as string };
}

test('verifying an email unlocks invites, and an invitee joins from the email they receive', async ({ browser }) => {
  const owner = await newUser(browser, 'Owner');

  await test.step('before verifying, a banner explains and email invites are off', async () => {
    await expect(owner.page.getByTestId('verify-email-banner')).toContainText(owner.email);
    const { id } = await trip(owner.page);
    await owner.page.goto(`/app/trips/${id}`);
    await owner.page.getByTestId('trip-invite-button').click();
    await expect(owner.page.getByTestId('members-verify-note')).toBeVisible();
    await expect(owner.page.getByTestId('members-invite-email-input')).toHaveCount(0);
    await expect(owner.page.getByTestId('members-copy-link-button')).toBeVisible();
    await owner.page.keyboard.press('Escape');
  });

  await test.step('the emailed link verifies, and the banner goes away', async () => {
    await verify(owner.page, owner.email);
    await owner.page.getByTestId('verify-email-continue').click();
    await expect(owner.page.getByTestId('dashboard-welcome')).toBeVisible();
    await expect(owner.page.getByTestId('verify-email-banner')).toHaveCount(0);
  });

  const invitee = `friend-${stamp}@example.test`;
  const { id } = await trip(owner.page, { name: 'Invite Me Trip' });

  await test.step('inviting by email really sends an email', async () => {
    await owner.page.goto(`/app/trips/${id}`);
    await owner.page.getByTestId('trip-invite-button').click();
    await owner.page.getByTestId('members-invite-email-input').fill(invitee);
    await owner.page.getByTestId('members-invite-send-button').click();
await owner.page.getByTestId('members-tab-members').click();
    await expect(owner.page.getByTestId('members-dialog')).toContainText('Invited');
    await owner.page.keyboard.press('Escape');
  });

  const friend = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await friend.newPage();

  await test.step('the invite email leads to signup with the address filled in, and shows nothing until verified', async () => {
    await page.goto(linkIn(await emailText(invitee, 'invited you to Invite Me Trip'), 'signup'));
    await expect(page.getByTestId('signup-email-input')).toHaveValue(invitee);
    await fillSignup(page, 'Friend Tester', invitee);
    await page.getByTestId('dashboard-welcome').waitFor();
    await expect(page.getByTestId('dashboard-invitations')).toHaveCount(0);
    await expect(page.getByText('Invite Me Trip')).toHaveCount(0);
  });

  await test.step('after verifying, the invite appears and can be accepted', async () => {
    await verify(page, invitee);
    await page.getByTestId('verify-email-continue').click();
    await expect(page.getByTestId('dashboard-invitations')).toContainText('Invite Me Trip');
    await page.getByTestId('dashboard-invite-accept').click();
    await expect(page.getByTestId('trip-header-name')).toHaveText('Invite Me Trip');
  });

  await test.step('the owner sees them join live', async () => {
    await expect(owner.page.getByTestId('overview-members')).toContainText('Friend Tester');
  });

  await friend.close();
  await owner.context.close();
});

test('forgot password works end to end through email', async ({ browser }) => {
  const user = await newUser(browser, 'Forgetful');
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/forgot-password');
  await page.getByTestId('forgot-email-input').fill(user.email);
  await page.getByTestId('forgot-submit-button').click();
  await page.getByTestId('forgot-success').waitFor();
  await page.goto(linkIn(await emailText(user.email, 'Reset your TripOS password'), 'reset-password'));
  await page.getByTestId('reset-password-input').fill('a-brand-new-password');
  await page.getByTestId('reset-password-submit-button').click();
  await page.waitForURL(/\/login/);
  await page.getByTestId('login-email-input').fill(user.email);
  await page.getByTestId('login-password-input').fill('a-brand-new-password');
  await page.getByTestId('login-submit-button').click();
  await expect(page.getByTestId('dashboard-welcome')).toBeVisible();
  await expect(page.getByTestId('verify-email-banner')).toHaveCount(0);
  await user.page.reload();
  await expect(user.page).toHaveURL(/\/login/);
  await context.close();
  await user.context.close();
});

test('switching currency converts everything for everyone, instead of relabelling', async ({ browser }) => {
  const owner = await newUser(browser, 'Convert');
  const member = await newUser(browser, 'Member');
  // With no rates to suggest, people can still type their own. Automatic rates are in exchange-rates.spec.ts.
  await owner.page.route('**/api/exchange-rates*', (route) => route.abort());
  const { id, joinCode } = await trip(owner.page, { budget: 60000 });
  await api(member.page, 'POST', `/invites/${joinCode}/accept`);
  await Promise.all([owner.page.goto(`/app/trips/${id}/expenses`), member.page.goto(`/app/trips/${id}/expenses`)]);

  await owner.page.getByTestId('expenses-add-button').click();
  await owner.page.getByTestId('expense-title-input').fill('Dinner');
  await owner.page.getByTestId('expense-amount-input').fill('1000');
  await owner.page.getByTestId('expense-save-button').click();
  await expect(member.page.getByTestId('expenses-balances')).toContainText('owes ₹500');

  await test.step('choosing a currency asks for a rate rather than changing the symbol', async () => {
    await owner.page.getByTestId('expenses-currency-select').click();
    await owner.page.getByRole('option', { name: 'USD' }).click();
    await expect(owner.page.getByTestId('convert-currency-dialog')).toBeVisible();
    await owner.page.getByTestId('convert-confirm-button').click();
    await expect(owner.page.getByTestId('convert-currency-dialog')).toContainText('Enter the exchange rate');
    await expect(owner.page.getByTestId('expenses-stat-budget')).toContainText('₹60,000');
  });

  await test.step('converting changes the real amounts, live for the other member', async () => {
    await owner.page.getByTestId('convert-rate-input').fill('0.012');
    await expect(owner.page.getByTestId('convert-currency-dialog')).toContainText('$12');
    await owner.page.getByTestId('convert-confirm-button').click();
    await expect(owner.page.getByTestId('expenses-total-spent')).toHaveText('$12');
    await expect(owner.page.getByTestId('expenses-stat-budget')).toContainText('$720');
    await expect(member.page.getByTestId('expenses-balances')).toContainText('owes $6');
    await member.page.reload();
    await expect(member.page.getByTestId('expenses-balances')).toContainText('owes $6');
  });

  await test.step('a member cannot convert', async () => {
    await expect(member.page.getByTestId('expenses-currency-select')).toBeDisabled();
  });

  await test.step('an expense in another currency counts at the rate paid', async () => {
    await owner.page.getByTestId('expenses-add-button').click();
    await owner.page.getByTestId('expense-title-input').fill('Hotel in Bangkok');
    await owner.page.getByTestId('expense-amount-input').fill('1000');
    await owner.page.getByTestId('expense-currency-select').click();
    await owner.page.getByRole('option', { name: 'THB' }).click();
    await owner.page.getByTestId('expense-save-button').click();
    await expect(owner.page.getByTestId('expense-dialog')).toContainText('Enter the exchange rate');
    await owner.page.getByTestId('expense-rate-input').fill('0.03');
    await expect(owner.page.getByTestId('expense-dialog')).toContainText('Counts as $30');
    await owner.page.getByTestId('expense-save-button').click();
    await expect(member.page.getByTestId('expenses-history')).toContainText('Hotel in Bangkok');
    await expect(member.page.locator('[data-testid^="expense-original-"]').first()).toContainText('paid THB');
    await expect(owner.page.getByTestId('expenses-total-spent')).toHaveText('$42');
  });

  await owner.context.close();
  await member.context.close();
});

test('people who have not joined are not charged by default', async ({ browser }) => {
  const owner = await newUser(browser, 'Splitter');
  await verify(owner.page, owner.email);
  const { id } = await trip(owner.page);
  await api(owner.page, 'POST', `/trips/${id}/members`, { email: `pending-${stamp}@example.test` });
  await owner.page.goto(`/app/trips/${id}/expenses`);
  await owner.page.getByTestId('expenses-add-button').click();
  const dialog = owner.page.getByTestId('expense-dialog');
  await expect(dialog).toContainText('· invited');
  const boxes = dialog.locator('[data-testid^="expense-participant-"]');
  await expect(boxes).toHaveCount(2);
  const checked = await boxes.evaluateAll((els) => els.filter((e) => e.getAttribute('aria-checked') === 'true' || e.hasAttribute('data-checked')).length);
  expect(checked).toBe(1);
  await owner.context.close();
});

test('the wizard asks for a cover, and the other product gaps work', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'Gaps');

  await test.step('a trip gets a cover that suits its destination, without having to choose', async () => {
    await page.goto('/app/trips/new');
    await page.getByTestId('create-trip-next-button').click();
    await expect(page.getByTestId('create-trip-basics')).toContainText('Give your trip a name');
    await expect(page.locator('[data-invalid] #ct-name')).toBeVisible();
    await page.getByTestId('create-trip-name-input').fill('Gap Trip');
    await page.getByTestId('create-trip-destination-input').fill('Goa');
    await expect(page.locator('[data-testid^="create-trip-cover-"][aria-pressed="true"]')).toHaveAttribute('data-testid', /photo-1614082242765/);
    await page.getByTestId('create-trip-next-button').click();
    await page.getByTestId('create-trip-start-date-input').fill('2020-03-01');
    await page.getByTestId('create-trip-end-date-input').fill('2020-03-03');
    await page.getByTestId('create-trip-next-button').click();
    await expect(page.getByTestId('create-trip-verify-note')).toBeVisible();
    await page.getByTestId('create-trip-next-button').click();
    await page.getByTestId('create-trip-next-button').click();
    await page.getByTestId('create-trip-submit-button').click();
    await expect(page.getByTestId('trip-header-name')).toHaveText('Gap Trip');
  });

  const tripUrl = page.url();

  await test.step('activities have a type, and attachments are real files', async () => {
    await page.goto(`${tripUrl}/itinerary`);
    await page.getByTestId('itinerary-add-activity-button').click();
    await page.getByTestId('activity-title-input').fill('Beach lunch');
    await page.getByTestId('activity-type-select').click();
    await page.getByRole('option', { name: 'Meal' }).click();
    await page.getByTestId('activity-save-button').click();
    const card = page.locator('[data-testid^="activity-card-"]', { hasText: 'Beach lunch' });
    await expect(card.locator('[data-testid^="activity-type-"]')).toHaveText('Meal');
    await card.locator('[data-testid^="activity-toggle-details-"]').click();
    await card.locator('[data-testid^="activity-attach-"] input').setInputFiles(RECEIPT);
    const link = card.locator('[data-testid^="activity-attachment-"]');
    await expect(link).toContainText('receipt.png');
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/api\/files\//);
    expect((await page.request.get(href as string)).status()).toBe(200);
    await page.reload();
    await expect(page.locator('[data-testid^="activity-type-"]').first()).toHaveText('Meal');
  });

  await test.step('tasks have a status that stays in step with completion', async () => {
    await page.goto(`${tripUrl}/tasks`);
    await page.getByTestId('tasks-add-button').click();
    await page.getByTestId('task-title-input').fill('Book cabs');
    await page.getByTestId('task-status-select').click();
    await page.getByRole('option', { name: 'In progress' }).click();
    await page.getByTestId('task-save-button').click();
    await expect(page.locator('[data-testid^="task-in-progress-"]')).toBeVisible();
    await page.locator('[data-testid^="task-toggle-"]').first().click();
    await expect(page.locator('[data-testid^="task-in-progress-"]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-testid^="task-toggle-"]').first()).toHaveAttribute('aria-pressed', 'true');
  });

  await test.step('My Trips has a list view that stays in the address', async () => {
    await page.goto('/app/trips');
    await page.getByTestId('trips-view-list').click();
    await expect(page.getByTestId('trips-list')).toContainText('Gap Trip');
    await page.reload();
    await expect(page.getByTestId('trips-list')).toBeVisible();
    await page.getByTestId('trips-view-grid').click();
    await expect(page.getByTestId('trips-grid')).toBeVisible();
  });

  await test.step('Trip Replay highlights can be written and removed', async () => {
    await page.goto(`${tripUrl}/replay`);
    await page.getByTestId('replay-highlight-input').fill('The sunset at Chapora');
    await page.getByTestId('replay-highlight-add-button').click();
    await expect(page.getByTestId('replay-highlights')).toContainText('The sunset at Chapora');
    await page.reload();
    await expect(page.getByTestId('replay-highlights')).toContainText('The sunset at Chapora');
    await page.getByTestId('replay-highlight-remove-0').click();
    await expect(page.getByTestId('replay-highlights')).not.toContainText('The sunset at Chapora');
  });

  await test.step('appearance can be switched to dark and is remembered', async () => {
    await page.goto('/app/settings');
    await page.getByTestId('settings-tab-appearance').click();
    await page.getByTestId('settings-theme-dark').click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByTestId('settings-tab-appearance').click();
    await page.getByTestId('settings-theme-light').click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  await test.step('receipt scanning is no longer offered', async () => {
    await page.goto(`${tripUrl}/expenses`);
    await expect(page.getByTestId('expenses-balances')).toBeVisible();
    await expect(page.getByText('Scan receipt')).toHaveCount(0);
  });

  await context.close();
});
