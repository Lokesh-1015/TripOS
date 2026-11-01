// One test for each issue found in the manual Playwright review, so they can't quietly return.
import { expect, test, type Browser, type Page } from '@playwright/test';

const stamp = Date.now().toString(36);
let counter = 0;

async function newUser(browser: Browser, first: string, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto('/signup');
  await page.getByTestId('signup-name-input').fill(`${first} Tester`);
  await page.getByTestId('signup-email-input').fill(`${first.toLowerCase()}-${stamp}-${++counter}@example.test`);
  await page.getByTestId('signup-password-input').fill('correct-horse');
  await page.getByTestId('signup-submit-button').click();
  await page.getByTestId('onboarding-next-button').click();
  await page.getByTestId('onboarding-finish-button').click();
  await page.getByTestId('dashboard-welcome').waitFor();
  return { page, context };
}

const api = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([m, u, b]) => {
      const r = await fetch(`/api${u}`, { method: m as string, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [method, path, body] as const,
  );

async function createTrip(page: Page) {
  const id = `trip-${stamp}-${++counter}`;
  const made = await api(page, 'POST', '/trips', { id, name: 'Regression trip', destination: 'Goa', cover: 'https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3', startDate: '2030-03-01', endDate: '2030-03-04' });
  expect(made.status).toBe(201);
  return { id, joinCode: made.body.joinCode as string };
}

test('rapid clicks on your own task never report a false conflict', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'Rapid');
  const { id } = await createTrip(page);
  const me = (await api(page, 'GET', '/state')).body.user.id;
  await api(page, 'PUT', `/trips/${id}/tasks/task-rapid-${stamp}`, { title: 'Book cabs', assignee: me, due: '2030-02-01', priority: 'high' });
  await page.goto(`/app/trips/${id}/tasks`);
  const toggle = page.locator('[data-testid^="task-toggle-"]').first();
  await toggle.waitFor();
  for (let i = 0; i < 7; i++) await toggle.click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('[data-testid^="task-toggle-"]').first()).toHaveAttribute('aria-pressed', 'true');
  await context.close();
});

test('a real conflict is still caught, and shows only the error', async ({ browser }) => {
  const a = await newUser(browser, 'Conflict');
  const b = await newUser(browser, 'Other');
  const { id, joinCode } = await createTrip(a.page);
  await api(b.page, 'POST', `/invites/${joinCode}/accept`);
  const me = (await api(a.page, 'GET', '/state')).body.user.id;
  await api(a.page, 'PUT', `/trips/${id}/tasks/task-conflict-${stamp}`, { title: 'Shared task', assignee: me, due: '2030-02-01', priority: 'high' });
  await Promise.all([a.page.goto(`/app/trips/${id}/tasks`), b.page.goto(`/app/trips/${id}/tasks`)]);
  for (const { page } of [a, b]) {
    const row = page.locator('[data-testid^="task-row-"]').first();
    await row.hover();
    await row.locator('[data-testid^="task-edit-"]').click();
  }
  await a.page.getByTestId('task-title-input').fill('From A');
  await b.page.getByTestId('task-title-input').fill('From B');
  await a.page.getByTestId('task-save-button').click();
  await a.page.locator('[data-sonner-toast]', { hasText: 'Task updated' }).waitFor();
  await b.page.waitForTimeout(800);
  await b.page.getByTestId('task-save-button').click();
  await expect(b.page.locator('[data-sonner-toast][data-type="error"]', { hasText: 'Someone else just changed this' })).toBeVisible();
  await expect(b.page.locator('[data-sonner-toast]', { hasText: 'Task updated' })).toHaveCount(0);
  await expect(b.page.locator('[data-testid^="task-row-"]').first()).toContainText('From A');
  await a.context.close();
  await b.context.close();
});

test('a change made while offline is held, then saved on reconnect', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'Offline');
  const { id } = await createTrip(page);
  await page.goto(`/app/trips/${id}/tasks`);
  await page.getByTestId('tasks-add-button').waitFor();
  await context.setOffline(true);
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await page.getByTestId('tasks-add-button').click();
  await page.getByTestId('task-title-input').fill('Written offline');
  await page.getByTestId('task-save-button').click();
  await expect(page.getByText('Written offline')).toBeVisible();
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Task created' })).toHaveCount(0);
  await page.waitForTimeout(1500);
  await context.setOffline(false);
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Task created' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('offline-banner')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Written offline')).toBeVisible();
  await context.close();
});

test('trip screens have no sideways scrolling on a phone', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'Phone', { width: 390, height: 844 });
  const { id } = await createTrip(page);
  const me = (await api(page, 'GET', '/state')).body.user.id;
  await api(page, 'PUT', `/trips/${id}/expenses/exp-phone-${stamp}`, { title: 'A long dinner bill at the beach shack', amount: 1234567.89, category: 'food', paidBy: me, date: '2030-03-01', splitType: 'equal', shares: [{ memberId: me, amount: 1234567.89 }] });
  await api(page, 'PUT', `/trips/${id}/tasks/task-phone-${stamp}`, { title: 'Book cabs', assignee: me, due: '2030-02-01', priority: 'high' });
  const screens = ['', '/itinerary', '/expenses', '/tasks', '/packing', '/documents', '/map', '/chat', '/memories'];
  const overflowing: string[] = [];
  for (const screen of screens) {
    await page.goto(`/app/trips/${id}${screen}`);
    await page.getByTestId('trip-header').waitFor();
    await page.waitForTimeout(250);
    const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (extra > 0) overflowing.push(`${screen || '/overview'} +${extra}px`);
  }
  expect(overflowing).toEqual([]);
  await context.close();
});

test('an empty dashboard explains itself instead of showing blank sections', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'Empty');
  await expect(page.getByTestId('dashboard-trips-empty')).toBeVisible();
  await expect(page.getByTestId('dashboard-expenses-empty')).toBeVisible();
  await expect(page.getByTestId('dashboard-activity-empty')).toBeVisible();
  await context.close();
});

test('people only see the actions their role allows, and the server still refuses the rest', async ({ browser }) => {
  const owner = await newUser(browser, 'Owner');
  const member = await newUser(browser, 'Member');
  const viewer = await newUser(browser, 'Viewer');
  const { id, joinCode } = await createTrip(owner.page);
  await api(member.page, 'POST', `/invites/${joinCode}/accept`);
  await api(viewer.page, 'POST', `/invites/${joinCode}/accept`);
  const viewerId = (await api(viewer.page, 'GET', '/state')).body.user.id;
  await api(owner.page, 'PATCH', `/trips/${id}/members/${viewerId}`, { role: 'viewer' });

  await owner.page.goto(`/app/trips/${id}`);
  await expect(owner.page.getByTestId('trip-edit-button')).toBeVisible();
  await owner.page.getByTestId('trip-more-menu-button').click();
  await expect(owner.page.getByTestId('trip-menu-delete')).toBeVisible();
  await owner.page.keyboard.press('Escape');

  await member.page.goto(`/app/trips/${id}`);
  await expect(member.page.getByTestId('trip-header-name')).toBeVisible();
  await expect(member.page.getByTestId('overview-new-poll-button')).toBeVisible();
  await expect(member.page.getByTestId('trip-edit-button')).toHaveCount(0);
  await expect(member.page.getByTestId('trip-share-button')).toHaveCount(0);
  await expect(member.page.getByTestId('trip-more-menu-button')).toHaveCount(0);
  await member.page.getByTestId('trip-invite-button').click();
  await expect(member.page.getByTestId('members-invite-email-input')).toHaveCount(0);
  await expect(member.page.locator('[data-testid^="member-remove-"]')).toHaveCount(0);
  await member.page.keyboard.press('Escape');
  expect((await api(member.page, 'PATCH', `/trips/${id}`, { name: 'Hijacked' })).status).toBe(403);

  await viewer.page.goto(`/app/trips/${id}/tasks`);
  await expect(viewer.page.getByTestId('trip-header-name')).toBeVisible();
  await expect(viewer.page.getByTestId('tasks-add-button')).toHaveCount(0);
  await viewer.page.goto(`/app/trips/${id}/expenses`);
  await expect(viewer.page.getByTestId('expenses-balances')).toBeVisible();
  await expect(viewer.page.getByTestId('expenses-add-button')).toHaveCount(0);
  await viewer.page.goto(`/app/trips/${id}/chat`);
  await expect(viewer.page.getByTestId('chat-read-only')).toBeVisible();
  await expect(viewer.page.getByTestId('chat-message-input')).toHaveCount(0);
  await viewer.page.goto(`/app/trips/${id}/packing`);
  await expect(viewer.page.getByTestId('packing-progress-label')).toBeVisible();
  await expect(viewer.page.getByTestId('packing-add-button')).toHaveCount(0);
  await viewer.page.goto(`/app/trips/${id}/documents`);
  await expect(viewer.page.getByTestId('documents-visibility-shared')).toBeVisible();
  await expect(viewer.page.getByTestId('documents-upload-button')).toHaveCount(0);
  await viewer.page.goto(`/app/trips/${id}/itinerary`);
  await expect(viewer.page.getByTestId('itinerary-day-nav')).toBeVisible();
  await expect(viewer.page.getByTestId('itinerary-add-activity-button')).toHaveCount(0);
  expect((await api(viewer.page, 'PUT', `/trips/${id}/tasks/task-viewer-${stamp}`, { title: 'Sneaky', assignee: viewerId, due: '2030-02-01', priority: 'low' })).status).toBe(403);

  await owner.context.close();
  await member.context.close();
  await viewer.context.close();
});

test('a change made while a page is still connecting is not missed', async ({ browser }) => {
  const a = await newUser(browser, 'Sender');
  const b = await newUser(browser, 'Late');
  const { id, joinCode } = await createTrip(a.page);
  await api(b.page, 'POST', `/invites/${joinCode}/accept`);

  // Hold the second person's live connection open for a moment after their page has loaded its data.
  await b.page.routeWebSocket(/socket\.io/, async (ws) => {
    await new Promise((r) => setTimeout(r, 2000));
    ws.connectToServer();
  });
  await b.page.goto(`/app/trips/${id}/chat`);
  await b.page.getByTestId('chat-panel').waitFor();

  const me = (await api(a.page, 'GET', '/state')).body.user.id;
  expect(me).toBeTruthy();
  expect((await api(a.page, 'PUT', `/trips/${id}/messages/msg-late-${stamp}`, { kind: 'text', text: 'Sent during the gap' })).status).toBe(200);

  await expect(b.page.getByTestId('chat-messages')).toContainText('Sent during the gap', { timeout: 8000 });
  await a.context.close();
  await b.context.close();
});
