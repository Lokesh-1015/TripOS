// Profiles, friend requests, blocking and reporting between two real browsers.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const RECEIPT = path.join(__dirname, '..', 'fixtures', 'receipt.png');
const LATEST_RELEASE = /id: "([^"]+)"/.exec(readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'releaseNotes.ts'), 'utf8'))?.[1];
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

/** A real traveller: signed up, confirmed by the emailed link, past onboarding. */
async function traveller(browser: Browser, first: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
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
  return { page, name, email, username };
}

const findAndOpen = async (page: Page, person: { name: string; username: string }) => {
  await page.goto('/app/people');
  await page.getByTestId('people-search-input').fill(person.name);
  await page.getByTestId(`traveller-link-${person.username}`).click();
  await expect(page.getByTestId('profile-name')).toHaveText(person.name);
};

test('two travellers find each other and become friends', async ({ browser }) => {
  test.setTimeout(120_000);
  const asha = await traveller(browser, 'Asha');
  const ravi = await traveller(browser, 'Ravi');

  await test.step('a new profile is private, and shows a stranger almost nothing', async () => {
    await asha.page.goto(`/app/u/${asha.username}`);
    await expect(asha.page.getByTestId('profile-visibility')).toContainText('Private profile');
    await asha.page.getByTestId('profile-edit-button').click();
    await asha.page.getByTestId('profile-bio-input').fill('Always chasing the next summit');
    await asha.page.getByTestId('profile-location-input').fill('Pune');
    await asha.page.getByTestId('profile-favourites-input').fill('Spiti, Hampi');
    await asha.page.getByTestId('profile-styles').getByRole('button', { name: 'Mountains' }).click();
    await asha.page.getByTestId('profile-save').click();
    await expect(asha.page.getByTestId('profile-edit-dialog')).toHaveCount(0);
    await expect(asha.page.getByTestId('profile-favourites-list')).toContainText('Hampi');
    await asha.page.reload();
    await expect(asha.page.getByTestId('profile-bio')).toHaveText('Always chasing the next summit');

    await findAndOpen(ravi.page, asha);
    await expect(ravi.page.getByTestId('profile-private-note')).toBeVisible();
    await expect(ravi.page.getByTestId('profile-page')).not.toContainText('Pune');
    await expect(ravi.page.getByTestId('profile-page')).not.toContainText('summit');
    await expect(ravi.page.getByTestId('profile-page')).not.toContainText(asha.email);
  });

  await test.step('the request moves through Add Friend, Request Sent, Accept Request and Friends', async () => {
    await ravi.page.getByTestId('friend-state-add').click();
    await expect(ravi.page.getByTestId('friend-state-sent')).toBeVisible();

    await expect(asha.page.getByTestId('notifications-bell-count').or(asha.page.getByTestId('notifications-bell-button').locator('span'))).toBeVisible({ timeout: 15_000 });
    await asha.page.getByTestId('notifications-bell-button').click();
    await asha.page.getByText(`${ravi.name} sent you a friend request`).click();
    await expect(asha.page).toHaveURL(/\/app\/people\?tab=requests/);
    await expect(asha.page.getByTestId('requests-incoming')).toContainText(ravi.name);
    await asha.page.getByTestId(`request-accept-${ravi.username}`).click();
    await expect(asha.page.getByTestId('requests-empty')).toBeVisible();

    await ravi.page.reload();
    await expect(ravi.page.getByTestId('friend-state-friends')).toBeVisible();
    await expect(ravi.page.getByTestId('profile-location')).toContainText('Pune');
    await expect(ravi.page.getByTestId('profile-favourites-list')).toContainText('Spiti');
  });

  await test.step('both appear in each other\'s friends, and removing ends it', async () => {
    await asha.page.getByTestId('people-tab-friends').click();
    await expect(asha.page.getByTestId('friends-list')).toContainText(ravi.name);
    await ravi.page.goto('/app/people?tab=friends');
    await expect(ravi.page.getByTestId('friends-list')).toContainText(asha.name);
    await ravi.page.getByTestId(`friend-remove-${asha.username}`).click();
    await expect(ravi.page.getByTestId('friends-empty')).toBeVisible();
  });

  await asha.page.context().close();
  await ravi.page.context().close();
});

test('going public shows the details, and a declined or cancelled request behaves', async ({ browser }) => {
  test.setTimeout(120_000);
  const meera = await traveller(browser, 'Meera');
  const dev = await traveller(browser, 'Dev');

  await meera.page.goto(`/app/u/${meera.username}`);
  await meera.page.getByTestId('profile-edit-button').click();
  await meera.page.getByTestId('profile-location-input').fill('Kochi');
  await meera.page.getByTestId('profile-cover-input').setInputFiles(RECEIPT);
  await meera.page.getByTestId('profile-public-switch').click();
  await meera.page.getByTestId('profile-save').click();
  await expect(meera.page.getByTestId('profile-visibility')).toContainText('Public profile');
  await expect(meera.page.getByTestId('profile-cover').locator('img')).toBeVisible();

  await findAndOpen(dev.page, meera);
  await expect(dev.page.getByTestId('profile-location')).toContainText('Kochi');

  await dev.page.getByTestId('friend-state-add').click();
  await dev.page.getByTestId('friend-state-sent').click();
  await expect(dev.page.getByTestId('friend-state-add')).toBeVisible();

  await dev.page.getByTestId('friend-state-add').click();
  await expect(dev.page.getByTestId('friend-state-sent')).toBeVisible();
  await meera.page.goto('/app/people?tab=requests');
  await meera.page.getByTestId(`request-decline-${dev.username}`).click();
  await expect(meera.page.getByTestId('requests-declined')).toContainText(dev.name);

  await dev.page.reload();
  await expect(dev.page.getByTestId('friend-state-add')).toBeVisible();
  await dev.page.getByTestId('friend-state-add').click();
  await expect(dev.page.getByText("You can't send another request")).toBeVisible();

  await meera.page.getByTestId(`request-accept-declined-${dev.username}`).click();
  await expect(meera.page.getByTestId('requests-empty')).toBeVisible();
  await dev.page.reload();
  await expect(dev.page.getByTestId('friend-state-friends')).toBeVisible();

  await meera.page.context().close();
  await dev.page.context().close();
});

test('blocking hides both people, and reporting is confirmed', async ({ browser }) => {
  test.setTimeout(120_000);
  const tara = await traveller(browser, 'Tara');
  const sam = await traveller(browser, 'Sam');

  await findAndOpen(tara.page, sam);
  await tara.page.getByTestId('profile-menu').click();
  await tara.page.getByTestId('profile-report').click();
  await tara.page.getByTestId('report-details').fill('Keeps messaging me');
  await tara.page.getByTestId('report-send').click();
  await expect(tara.page.getByText("we've received your report")).toBeVisible();

  await tara.page.getByTestId('profile-menu').click();
  await tara.page.getByTestId('profile-block').click();
  await tara.page.getByRole('button', { name: 'Block', exact: true }).click();
  await expect(tara.page).toHaveURL(/\/app\/people/);

  await tara.page.getByTestId('people-search-input').fill(sam.name);
  await expect(tara.page.getByTestId('people-search-empty')).toBeVisible();
  await sam.page.goto(`/app/u/${tara.username}`);
  await expect(sam.page.getByTestId('profile-not-found')).toBeVisible();

  await tara.page.getByTestId('people-tab-blocked').click();
  await expect(tara.page.getByTestId('blocked-list')).toContainText(sam.name);
  await tara.page.getByTestId(`unblock-${sam.username}`).click();
  await expect(tara.page.getByTestId('blocked-empty')).toBeVisible();
  await sam.page.reload();
  await expect(sam.page.getByTestId('profile-name')).toHaveText(tara.name);

  await tara.page.context().close();
  await sam.page.context().close();
});

test('the app stays usable without any of this, and People is easy to find', async ({ browser }) => {
  const nina = await traveller(browser, 'Nina');
  await nina.page.goto('/app');
  await nina.page.getByRole('link', { name: 'People' }).first().click();
  await expect(nina.page).toHaveURL(/\/app\/people/);
  await expect(nina.page.getByTestId('people-search-input')).toBeVisible();
  await nina.page.goto('/app/settings');
  await nina.page.getByTestId('settings-tab-privacy').click();
  await expect(nina.page.getByTestId('settings-profile-privacy')).toContainText('private');
  await nina.page.context().close();
});
