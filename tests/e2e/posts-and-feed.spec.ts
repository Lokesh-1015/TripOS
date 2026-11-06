// PRD journeys 5 and 7: sharing a travel post, and sharing a trip memory as a post, between real browsers.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const RECEIPT = path.join(__dirname, '..', 'fixtures', 'receipt.png');
const LATEST_RELEASE = /id: "([^"]+)"/.exec(readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'releaseNotes.ts'), 'utf8'))?.[1];
const COVER = 'https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3';
const stamp = Date.now().toString(36);
let counter = 0;

async function verifyToken(email: string) {
  for (let i = 0; i < 50; i++) {
    const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}" subject:"Verify"`)}`)).json();
    if (found.messages?.length) {
      const text = (await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json()).Text as string;
      return text.match(/verify-email\/([\w-]+)/)?.[1] as string;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No verification email for ${email}`);
}

async function traveller(browser: Browser, first: string) {
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
  await page.goto('/app');
  await page.getByTestId('dashboard-welcome').waitFor();
  return { page, name, username };
}

const api = (page: Page, method: string, url: string, body?: unknown) =>
  page.evaluate(async ({ method, url, body }) => {
    const res = await fetch(`/api${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { method, url, body });

async function befriend(a: { page: Page; username: string }, b: { page: Page; username: string }) {
  expect((await api(a.page, 'POST', '/friends/requests', { username: b.username })).status).toBeLessThan(300);
  const incoming = (await api(b.page, 'GET', '/friends/requests')).body.incoming[0];
  expect((await api(b.page, 'POST', `/friends/requests/${incoming.id}/accept`)).status).toBe(200);
}

test('sharing a travel post, which friends can like and comment on and strangers can\'t see', async ({ browser }) => {
  test.setTimeout(150_000);
  const asha = await traveller(browser, 'Asha');
  const ravi = await traveller(browser, 'Ravi');
  const stranger = await traveller(browser, 'Stranger');
  await befriend(asha, ravi);
  const caption = `Sunrise at Hampi ${stamp}`;

  await test.step('create a post with two photos, a destination and friends-only visibility', async () => {
    await asha.page.getByRole('link', { name: 'Feed' }).first().click();
    await asha.page.getByTestId('feed-create-post').click();
    await asha.page.getByTestId('create-post-file-input').setInputFiles([RECEIPT, RECEIPT]);
    await expect(asha.page.getByTestId('create-post-photos').locator('img')).toHaveCount(2);
    await asha.page.getByTestId('create-post-caption').fill(caption);
    await asha.page.getByTestId('create-post-destination').fill('Hampi');
    await asha.page.getByTestId('post-visibility').click();
    await asha.page.getByRole('option', { name: 'Friends' }).click();
    await asha.page.getByTestId('create-post-publish').click();
    await expect(asha.page.getByTestId('create-post-dialog')).toHaveCount(0);
    await expect(asha.page.getByTestId('feed-list')).toContainText(caption);
    await expect(asha.page.locator('[data-testid^="post-visibility-"]').first()).toContainText('Friends');
  });

  await test.step('a friend sees it in their feed, likes it and comments', async () => {
    await ravi.page.goto('/app/feed');
    const card = ravi.page.locator('[data-testid^="post-"]', { hasText: caption }).first();
    await expect(card).toBeVisible();
    await expect(card.locator('[data-testid^="post-photo-dots-"] button')).toHaveCount(2);
    await card.locator('[data-testid^="post-like-"]').click();
    await expect(card.locator('[data-testid^="post-like-"]')).toHaveAttribute('aria-pressed', 'true');
    await card.locator('[data-testid^="post-comments-toggle-"]').click();
    await card.locator('[data-testid^="post-comment-input-"]').fill('Wish I was there');
    await card.locator('[data-testid^="post-comment-send-"]').click();
    await expect(card.locator('[data-testid^="post-comments-"]:not([data-testid*="toggle"])')).toContainText('Wish I was there');
  });

  await test.step('the author is told, and opening the notification shows the post', async () => {
    await asha.page.reload();
    await asha.page.getByTestId('notifications-bell-button').click();
    await asha.page.getByText(`${ravi.name} commented on your post`).click();
    await expect(asha.page).toHaveURL(/\/app\/posts\//);
    await expect(asha.page.locator('[data-testid^="post-comments-"]:not([data-testid*="toggle"])').first()).toContainText('Wish I was there');
  });

  await test.step('someone who isn\'t a friend sees nothing, even with the photo\'s address', async () => {
    const postUrl = asha.page.url();
    const photo = await asha.page.locator('[data-testid^="post-photo-"]').first().getAttribute('src');
    await stranger.page.goto('/app/feed');
    await expect(stranger.page.getByText(caption)).toHaveCount(0);
    await stranger.page.goto(new URL(postUrl).pathname);
    await expect(stranger.page.getByTestId('post-missing')).toBeVisible();
    expect((await stranger.page.request.get(photo as string)).status()).toBe(404);
    await stranger.page.goto(`/app/u/${asha.username}`);
    await expect(stranger.page.getByTestId('profile-posts-empty')).toBeVisible();
  });

  await test.step('the author edits and then deletes it', async () => {
    await asha.page.locator('[data-testid^="post-menu-"]').first().click();
    await asha.page.locator('[data-testid^="post-edit-"]').first().click();
    await asha.page.getByTestId('edit-post-caption').fill(`${caption} edited`);
    await asha.page.getByTestId('edit-post-save').click();
    await expect(asha.page.locator('[data-testid^="post-caption-"]').first()).toHaveText(`${caption} edited`);
    await asha.page.locator('[data-testid^="post-menu-"]').first().click();
    await asha.page.locator('[data-testid^="post-delete-"]').first().click();
    await asha.page.getByRole('button', { name: 'Delete post' }).click();
    await asha.page.goto('/app/feed');
    await expect(asha.page.getByText(caption)).toHaveCount(0);
  });

  for (const p of [asha, ravi, stranger]) await p.page.context().close();
});

test('sharing a trip memory as a post leaves the memory and its trip unchanged', async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await traveller(browser, 'Host');
  const viewer = await traveller(browser, 'Viewer');
  const id = `trip-${stamp}-${++counter}`;
  expect((await api(host.page, 'POST', '/trips', { id, name: 'Private Goa', destination: 'Goa', cover: COVER, startDate: '2031-01-01', endDate: '2031-01-03' })).status).toBe(201);

  await host.page.goto(`/app/trips/${id}/memories`);
  await host.page.getByTestId('memories-file-input').setInputFiles(RECEIPT);
  const memory = host.page.locator('[data-testid^="memory-photo-"]').first();
  await expect(memory.locator('img')).toBeVisible();
  const memoryUrl = await memory.locator('img').getAttribute('src');

  await memory.click();
  await host.page.getByTestId('memory-share-as-post').click();
  await expect(host.page.getByTestId('create-post-memory-photo')).toBeVisible();
  await host.page.getByTestId('create-post-caption').fill(`Beach day ${stamp}`);
  await host.page.getByTestId('post-visibility').click();
  await host.page.getByRole('option', { name: 'Public' }).click();
  await host.page.getByTestId('create-post-publish').click();
  await expect(host.page.getByText("The memory in your trip hasn't changed")).toBeVisible();

  await test.step('the memory is still there, and still private to the trip', async () => {
    await host.page.reload();
    await expect(host.page.locator('[data-testid^="memory-photo-"] img')).toHaveCount(1);
    expect((await viewer.page.request.get(memoryUrl as string)).status()).toBe(404);
  });

  await test.step('the post shows its own copy to everyone, without naming the private trip', async () => {
    await viewer.page.goto('/app/feed');
    const card = viewer.page.locator('[data-testid^="post-"]', { hasText: `Beach day ${stamp}` }).first();
    await expect(card).toBeVisible();
    const postPhoto = await card.locator('[data-testid^="post-photo-"]').getAttribute('src');
    expect(postPhoto).not.toBe(memoryUrl);
    expect((await viewer.page.request.get(postPhoto as string)).status()).toBe(200);
    await expect(card).not.toContainText('Private Goa');
  });

  await test.step('deleting the memory leaves the post', async () => {
    await host.page.locator('[data-testid^="memory-photo-"]').first().click();
    await host.page.getByTestId('memory-delete-button').click();
    await host.page.getByRole('button', { name: 'Delete photo' }).click();
    await viewer.page.reload();
    await expect(viewer.page.locator('[data-testid^="post-"]', { hasText: `Beach day ${stamp}` }).first().locator('[data-testid^="post-photo-"]')).toBeVisible();
  });

  await host.page.context().close();
  await viewer.page.context().close();
});

test('a post shared into a trip chat only opens for people who could see it', async ({ browser }) => {
  test.setTimeout(90_000);
  const author = await traveller(browser, 'Writer');
  const tripmate = await traveller(browser, 'Mate');
  const id = `trip-${stamp}-${++counter}`;
  const trip = await api(author.page, 'POST', '/trips', { id, name: 'Chat Trip', destination: 'Goa', cover: COVER, startDate: '2031-01-01', endDate: '2031-01-03' });
  expect((await api(tripmate.page, 'POST', `/invites/${trip.body.joinCode}/accept`)).status).toBeLessThan(300);
  const photo = await author.page.evaluate(async () => {
    const blob = await (await fetch('/favicon-32x32.png')).blob();
    const form = new FormData();
    form.append('file', new File([blob], 'p.png', { type: 'image/png' }));
    form.append('visibility', 'post');
    return (await (await fetch('/api/files', { method: 'POST', body: form })).json()).url as string;
  });
  const postId = `post-${stamp}-${++counter}`;
  expect((await api(author.page, 'POST', '/posts', { id: postId, caption: 'Only for me', visibility: 'only_me', photos: [photo] })).status).toBeLessThan(300);

  await author.page.goto(`/app/posts/${postId}`);
  await author.page.locator('[data-testid^="post-menu-"]').click();
  await author.page.locator('[data-testid^="post-share-"]').click();
  await author.page.getByTestId(`share-post-trip-${id}`).click();

  await tripmate.page.goto(`/app/trips/${id}/chat`);
  await expect(tripmate.page.locator('[data-testid^="chat-post-unavailable-"]')).toHaveText("This post isn't available to you");
  await author.page.goto(`/app/trips/${id}/chat`);
  await expect(author.page.locator('[data-testid^="chat-post-msg"]').or(author.page.locator('[data-testid^="chat-post-"]').first())).toContainText("post");
  await author.page.context().close();
  await tripmate.page.context().close();
});
