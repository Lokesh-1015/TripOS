// Two people in separate browser sessions, through the real UI, API and database.
import { expect, test, type Browser, type Page } from '@playwright/test';

const stamp = Date.now().toString(36);
const PASSWORD = 'correct-horse';

async function newUser(browser: Browser, first: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/images\.unsplash|ERR_|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return { page, context, errors, email: `${first.toLowerCase()}-${stamp}@example.test`, name: `${first} Tester` };
}

async function signUp(page: Page, name: string, email: string) {
  await page.goto('/signup');
  await page.getByTestId('signup-name-input').fill(name);
  await page.getByTestId('signup-email-input').fill(email);
  await page.getByTestId('signup-password-input').fill(PASSWORD);
  await page.getByTestId('signup-submit-button').click();
  await page.getByTestId('onboarding-next-button').click();
  await page.getByTestId('onboarding-finish-button').click();
  await page.getByTestId('onboarding-friends-skip').click();
}

test('two members plan a trip together and see each other live', async ({ browser }) => {
  const ishita = await newUser(browser, 'Ishita');
  const rohan = await newUser(browser, 'Rohan');

  await test.step('signed out visitors go to login, and bad passwords fail', async () => {
    await ishita.page.goto('/app');
    await expect(ishita.page).toHaveURL(/\/login/);
    await ishita.page.getByTestId('login-email-input').fill('nobody@example.test');
    await ishita.page.getByTestId('login-password-input').fill('wrong-password');
    await ishita.page.getByTestId('login-submit-button').click();
    await expect(ishita.page.getByTestId('login-error')).toContainText('Incorrect email or password');
  });

  await test.step('a new account starts empty, with no demo trips', async () => {
    await signUp(ishita.page, ishita.name, ishita.email);
    await expect(ishita.page.getByTestId('dashboard-welcome')).toContainText('Ishita');
    await expect(ishita.page.getByText('Manali Adventure')).toHaveCount(0);
    await expect(ishita.page.getByTestId('dashboard-empty-create')).toBeVisible();
  });

  await test.step('the create-trip wizard saves a trip', async () => {
    const p = ishita.page;
    await p.getByTestId('dashboard-empty-create').click();
    await p.getByTestId('create-trip-name-input').fill('Goa Weekend');
    await p.getByTestId('create-trip-destination-input').fill('Goa, India');
    await p.locator('[data-testid^="create-trip-cover-photo"]').first().click();
    await p.getByTestId('create-trip-next-button').click();
    await p.getByTestId('create-trip-start-date-input').fill('2030-03-01');
    await p.getByTestId('create-trip-end-date-input').fill('2030-03-04');
    await p.getByTestId('create-trip-next-button').click();
    await p.getByTestId('create-trip-next-button').click();
    await p.getByTestId('create-trip-budget-input').fill('50000');
    await p.getByTestId('create-trip-next-button').click();
    await p.getByTestId('create-trip-submit-button').click();
    await expect(p.getByTestId('trip-header-name')).toHaveText('Goa Weekend');
    await p.reload();
    await expect(p.getByTestId('trip-header-name')).toHaveText('Goa Weekend');
  });

  const tripUrl = ishita.page.url();

  await test.step('a second person joins through the invite link', async () => {
    await ishita.page.getByTestId('trip-invite-button').click();
    const link = (await ishita.page.getByTestId('members-copy-link-button').innerText()).trim();
    expect(link).toContain('/join/');
    await ishita.page.keyboard.press('Escape');

    await rohan.page.goto(link);
    await expect(rohan.page.getByTestId('join-trip-name')).toHaveText('Goa Weekend');
    await rohan.page.getByTestId('join-signup-button').click();
    await signUp(rohan.page, rohan.name, rohan.email);
    await rohan.page.getByTestId('join-trip-button').click();
    await expect(rohan.page.getByTestId('trip-header-name')).toHaveText('Goa Weekend');
  });

  await test.step('the owner sees the new member appear without reloading', async () => {
    await expect(ishita.page.getByTestId('overview-members')).toContainText('Rohan Tester');
  });

  await test.step('a task added by one appears live for the other', async () => {
    await rohan.page.goto(`${tripUrl}/tasks`);
    await ishita.page.goto(`${tripUrl}/tasks`);
    await ishita.page.getByTestId('tasks-add-button').click();
    await ishita.page.getByTestId('task-title-input').fill('Book the cabs');
    await ishita.page.getByTestId('task-save-button').click();
    await expect(rohan.page.getByText('Book the cabs')).toBeVisible();
    await rohan.page.getByRole('button', { name: 'Complete Book the cabs' }).click();
    await expect(ishita.page.getByRole('button', { name: 'Mark Book the cabs as not done' })).toBeVisible();
  });

  await test.step('chat messages arrive live in both directions', async () => {
    await ishita.page.goto(`${tripUrl}/chat`);
    await rohan.page.goto(`${tripUrl}/chat`);
    await ishita.page.getByTestId('chat-message-input').fill('Who is packing the speaker?');
    await ishita.page.getByTestId('chat-send-button').click();
    await expect(rohan.page.getByTestId('chat-messages')).toContainText('Who is packing the speaker?');
    await rohan.page.getByTestId('chat-message-input').fill('I will');
    await rohan.page.getByTestId('chat-send-button').click();
    await expect(ishita.page.getByTestId('chat-messages')).toContainText('I will');
  });

  await test.step('an expense updates both balances live and exactly', async () => {
    await ishita.page.goto(`${tripUrl}/expenses`);
    await rohan.page.goto(`${tripUrl}/expenses`);
    await ishita.page.getByTestId('expenses-add-button').click();
    await ishita.page.getByTestId('expense-title-input').fill('Beach shack dinner');
    await ishita.page.getByTestId('expense-amount-input').fill('1000.50');
    await ishita.page.getByTestId('expense-save-button').click();
    await expect(rohan.page.getByTestId('expenses-history')).toContainText('Beach shack dinner');
    await expect(rohan.page.getByTestId('expenses-balances')).toContainText('owes ₹500.25');
    await expect(ishita.page.getByTestId('expenses-balances')).toContainText('gets ₹500.25');
    await rohan.page.getByRole('button', { name: 'Settle' }).click();
    await rohan.page.getByRole('button', { name: 'Mark as settled' }).click();
    await expect(ishita.page.getByTestId('settlements-all-settled')).toBeVisible();
  });

  await test.step('votes are counted once and shown to everyone', async () => {
    await ishita.page.goto(tripUrl);
    await rohan.page.goto(tripUrl);
    await ishita.page.getByTestId('overview-new-poll-button').click();
    await ishita.page.getByTestId('new-poll-question-input').fill('Which beach?');
    await ishita.page.getByTestId('new-poll-option-input-0').fill('Anjuna');
    await ishita.page.getByTestId('new-poll-option-input-1').fill('Vagator');
    await ishita.page.getByTestId('new-poll-create-button').click();
    const option = rohan.page.locator('[data-testid^="poll-option-"]', { hasText: 'Anjuna' }).first();
    await option.click();
    await expect(ishita.page.locator('[data-testid^="poll-option-"]', { hasText: 'Anjuna' }).first().locator('[data-testid^="poll-option-votes-"]')).toHaveText('1');
  });

  await test.step('a member is not offered trip editing, and the server refuses it anyway', async () => {
    await expect(rohan.page.getByTestId('trip-edit-button')).toHaveCount(0);
    const status = await rohan.page.evaluate(async (url) => (await fetch(`/api/trips/${url.split('/trips/')[1]}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Hijacked' }) })).status, tripUrl);
    expect(status).toBe(403);
    await expect(rohan.page.getByTestId('trip-header-name')).toHaveText('Goa Weekend');
  });

  await test.step('removing a member takes them off the trip immediately', async () => {
    await ishita.page.getByTestId('trip-invite-button').click();
    await ishita.page.getByTestId('members-tab-members').click();
    const row = ishita.page.locator('[data-testid^="member-row-"]', { hasText: 'Rohan Tester' });
    await row.locator('[data-testid^="member-remove-"]').click();
    await ishita.page.getByRole('button', { name: 'Remove member' }).click();
    await expect(rohan.page).toHaveURL(/\/app\/trips$/);
  });

  await test.step('signing out ends the session, and logging back in restores the data', async () => {
    await ishita.page.goto('/app');
    await ishita.page.getByTestId('sidebar-account-menu-button').click();
    await ishita.page.getByTestId('account-menu-sign-out').click();
    await expect(ishita.page).toHaveURL(/\/login/);
    await ishita.page.goto('/app');
    await expect(ishita.page).toHaveURL(/\/login/);
    await ishita.page.getByTestId('login-email-input').fill(ishita.email);
    await ishita.page.getByTestId('login-password-input').fill(PASSWORD);
    await ishita.page.getByTestId('login-submit-button').click();
    await expect(ishita.page.getByTestId('dashboard-next-trip')).toContainText('Goa Weekend');
  });

  expect(ishita.errors, 'Ishita browser errors').toEqual([]);
  expect(rohan.errors, 'Rohan browser errors').toEqual([]);
  await ishita.context.close();
  await rohan.context.close();
});

test('the app stays usable at phone width', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signUp(page, 'Mobile Tester', `mobile-${stamp}@example.test`);
  await expect(page.getByTestId('mobile-bottom-nav')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});
