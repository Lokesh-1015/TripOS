// Staying signed in, Sign in with Google and confirming a real email, through the real UI. Google's own script is
// replaced, and it hands back test tokens the server only accepts outside production. Addresses at gmail.com here
// go through the real checks, and only ever reach the local mail catcher.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const COVER = 'https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3';
const stamp = Date.now().toString(36);
let counter = 0;
const unique = (name: string) => `${name}-${stamp}-${++counter}`;
const newContext = (browser: Browser) => browser.newContext({ viewport: { width: 1280, height: 860 } });

const googleCredential = (claims: { sub: string; email: string; name?: string; email_verified?: boolean }) =>
  `test-google.${Buffer.from(JSON.stringify({ email_verified: true, name: 'Google Person', ...claims })).toString('base64url')}`;

/** Stands in for Google: the button it draws signs in as whoever `identity` says. */
async function stubGoogle(context: BrowserContext, identity: { sub: string; email: string; name?: string; email_verified?: boolean }) {
  await context.route('**/api/auth/config', (route) => route.fulfill({ json: { googleClientId: 'test-client-id' } }));
  await context.route('**/accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.google = { accounts: { id: {
        initialize(options) { window.__callback = options.callback; },
        renderButton(parent) {
          const b = document.createElement('button');
          b.type = 'button'; b.textContent = 'Continue with Google'; b.dataset.testid = 'google-button';
          b.onclick = () => window.__callback({ credential: ${JSON.stringify(googleCredential(identity))} });
          parent.appendChild(b);
        },
      } } };`,
    }),
  );
}

async function emailText(address: string, subject: string) {
  for (let i = 0; i < 50; i++) {
    const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}" subject:"${subject}"`)}`)).json();
    if (found.messages?.length) return (await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json()).Text as string;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No "${subject}" email for ${address}`);
}

const verifyLink = (text: string) => text.match(/http:\/\/localhost:3000\/verify-email\/[\w-]+/)?.[0] as string;

async function fillSignup(page: Page, email: string, name = 'Real Person') {
  await page.goto('/signup');
  await page.getByTestId('signup-name-input').fill(name);
  await page.getByTestId('signup-email-input').fill(email);
  await page.getByTestId('signup-password-input').fill('correct-horse');
  await page.getByTestId('signup-submit-button').click();
}

async function finishOnboarding(page: Page) {
  await page.getByTestId('onboarding-next-button').click();
  await page.getByTestId('onboarding-finish-button').click();
  await page.getByTestId('onboarding-friends-skip').click();
  await page.getByTestId('dashboard-welcome').waitFor();
}

const api = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([m, u, b]) => {
      const r = await fetch(`/api${u}`, { method: m as string, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [method, path, body] as const,
  );

test.describe('staying signed in', () => {
  test('closing everything and coming back later keeps you signed in', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await context.newPage();
    await fillSignup(page, `stay-${stamp}@example.test`);
    await finishOnboarding(page);

    const cookie = (await context.cookies()).find((c) => c.name === 'tripos_session');
    // A cookie with no expiry dies when the browser closes.
    expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 50 * 24 * 60 * 60);
    expect(cookie?.httpOnly).toBe(true);

    const saved = await context.storageState();
    await context.close();
    const reopened = await browser.newContext({ viewport: { width: 1280, height: 860 }, storageState: saved });
    const again = await reopened.newPage();
    await again.goto('/app');
    await again.getByTestId('dashboard-welcome').waitFor();
    await reopened.close();
  });

  test('coming back to the main address or the login page goes straight to your trips', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await context.newPage();
    await fillSignup(page, `back-${stamp}@example.test`);
    await finishOnboarding(page);
    const saved = await context.storageState();
    await context.close();

    const reopened = await browser.newContext({ viewport: { width: 1280, height: 860 }, storageState: saved });
    const again = await reopened.newPage();
    for (const path of ['/', '/login', '/signup']) {
      await again.goto(path);
      await expect(again).toHaveURL(/\/app$/);
      await again.getByTestId('dashboard-welcome').waitFor();
    }
    await test.step('someone signed out still sees the public pages', async () => {
      await again.getByTestId('sidebar-account-menu-button').click();
      await again.getByTestId('account-menu-sign-out').click();
      await expect(again).toHaveURL(/\/login/);
      await again.goto('/');
      await expect(again.getByRole('link', { name: 'Log in' }).first()).toBeVisible();
      await expect(again).not.toHaveURL(/\/app/);
      await again.goto('/signup');
      await expect(again.getByTestId('signup-email-input')).toBeVisible();
    });
    await reopened.close();
  });

  test('a sleeping server doesn\'t log you out: the app waits for it to wake', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await context.newPage();
    await fillSignup(page, `sleep-${stamp}@example.test`);
    await finishOnboarding(page);

    // No copy on the device, as when opening on a new visit before it's saved. The server answers errors at first.
    await page.evaluate(() => new Promise((done) => { const r = indexedDB.deleteDatabase('tripos-offline'); r.onsuccess = r.onerror = r.onblocked = () => done(null); }));
    let failures = 2;
    await context.route('**/api/state', (route) => (failures-- > 0 ? route.fulfill({ status: 502, body: 'Bad gateway' }) : route.continue()));
    await page.goto('/app/trips');
    await expect(page.getByTestId('app-waking')).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/app\/trips/);
    await context.close();
  });

  test('an ended session still goes to the login page', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await context.newPage();
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
});

test.describe('new accounts confirm a real email', () => {
  test('addresses that can\'t be real are turned away before an account exists', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await context.newPage();
    for (const [email, reason] of [
      ['someone@example.com', 'doesn\'t look like a real email'],
      ['someone@mailinator.com', 'Temporary email addresses'],
      [`someone@no-such-domain-${stamp}-tripos.com`, 'check the address for typos'],
    ]) {
      await fillSignup(page, email);
      await expect(page.getByRole('alert').filter({ hasText: reason })).toBeVisible();
      await expect(page).toHaveURL(/\/signup/);
    }
    const login = await context.request.post('/api/auth/login', { data: { email: 'someone@mailinator.com', password: 'correct-horse' } });
    expect(login.status()).toBe(401);
    await context.close();
  });

  test('the app stays closed until the emailed link is clicked, then carries on where it left off', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await context.newPage();
    const email = `tripos.test.${unique('gate')}@gmail.com`;
    await fillSignup(page, email);

    await test.step('a confirmation screen names the address, and an email is sent', async () => {
      await expect(page).toHaveURL(/\/confirm-email/);
      await expect(page.getByTestId('confirm-email-address')).toHaveText(email);
      expect(verifyLink(await emailText(email, 'Verify your TripOS email'))).toBeTruthy();
    });

    await test.step('nothing else can be reached, on screen or by asking the server directly', async () => {
      for (const path of ['/app', '/app/trips', '/app/settings', '/onboarding']) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/confirm-email/);
      }
      const made = await api(page, 'POST', '/trips', { id: `trip-${unique('blocked')}`, name: 'Blocked', destination: 'Goa', cover: COVER, startDate: '2030-01-01', endDate: '2030-01-02' });
      expect(made.status).toBe(403);
      expect(made.body.code).toBe('email_unconfirmed');
      expect((await api(page, 'GET', '/state')).status).toBe(200);
    });

    await test.step('clicking the link in another tab opens this one up by itself', async () => {
      const other = await context.newPage();
      await other.goto(verifyLink(await emailText(email, 'Verify your TripOS email')));
      await other.getByTestId('verify-email-done').waitFor();
      await other.close();
      await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
    });

    await test.step('and everything works from then on, including a later return', async () => {
      await finishOnboarding(page);
      expect((await api(page, 'POST', '/trips', { id: `trip-${unique('ok')}`, name: 'Allowed', destination: 'Goa', cover: COVER, startDate: '2030-01-01', endDate: '2030-01-02' })).status).toBe(201);
      await page.reload();
      await page.getByTestId('dashboard-welcome').waitFor();
      await expect(page.getByTestId('verify-email-banner')).toHaveCount(0);
    });
    await context.close();
  });

  test('a typo can be fixed from the confirmation screen, and a new email goes to the right address', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await context.newPage();
    const wrong = `tripos.test.${unique('wrong')}@gmail.com`;
    const right = `tripos.test.${unique('right')}@gmail.com`;
    await fillSignup(page, wrong);
    await expect(page).toHaveURL(/\/confirm-email/);

    await page.getByTestId('confirm-email-change-button').click();
    await page.getByTestId('confirm-email-change-input').fill('still-wrong@mailinator.com');
    await page.getByTestId('confirm-email-change-save').click();
    await expect(page.getByTestId('confirm-email-change-error')).toContainText('Temporary');

    await page.getByTestId('confirm-email-change-input').fill(right);
    await page.getByTestId('confirm-email-change-save').click();
    await expect(page.getByTestId('confirm-email-address')).toHaveText(right);
    await page.goto(verifyLink(await emailText(right, 'Verify your TripOS email')));
    await page.getByTestId('verify-email-done').waitFor();
    await context.close();
  });

  test('the email can be sent again, and signing out still works', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await context.newPage();
    await fillSignup(page, `tripos.test.${unique('resend')}@gmail.com`);
    await expect(page).toHaveURL(/\/confirm-email/);
    await page.getByTestId('confirm-email-resend').click();
    await expect(page.locator('[data-sonner-toast]', { hasText: 'Sent' })).toBeVisible();
    await expect(page.getByTestId('confirm-email-resend')).toBeDisabled();
    await page.getByTestId('confirm-email-sign-out').click();
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test('an invite link survives confirming', async ({ browser }) => {
    const ownerContext = await newContext(browser);
    const owner = await ownerContext.newPage();
    await fillSignup(owner, `inviter-${unique('x')}@example.test`);
    await finishOnboarding(owner);
    const made = await api(owner, 'POST', '/trips', { id: `trip-${unique('join')}`, name: 'Invite Trip', destination: 'Goa', cover: COVER, startDate: '2030-01-01', endDate: '2030-01-02' });

    const context = await newContext(browser);
    const page = await context.newPage();
    const email = `tripos.test.${unique('joiner')}@gmail.com`;
    await fillSignup(page, email);
    await expect(page).toHaveURL(/\/confirm-email/);
    await page.goto(`/join/${made.body.joinCode}`);
    await page.getByTestId('join-trip-button').click();
    await expect(page).toHaveURL(/\/confirm-email/);
    await page.goto(verifyLink(await emailText(email, 'Verify your TripOS email')));
    await page.getByTestId('verify-email-done').waitFor();
    await ownerContext.close();
    await context.close();
  });

  test('an older account that never confirmed isn\'t locked out, and just sees the reminder', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await context.newPage();
    await fillSignup(page, `older-${stamp}@example.test`);
    await finishOnboarding(page);
    await expect(page.getByTestId('verify-email-banner')).toBeVisible();
    await expect(page).toHaveURL(/\/app/);
    await context.close();
  });
});

test.describe('Sign in with Google', () => {
  test('without it set up, there\'s no button, and email and password work as before', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await context.newPage();
    await page.goto('/login');
    await expect(page.getByTestId('login-email-input')).toBeVisible();
    await expect(page.getByTestId('google-signin')).toHaveCount(0);
    await context.close();
  });

  test('if Google\'s script can\'t load, the page still works', async ({ browser }) => {
    const context = await newContext(browser);
    await context.route('**/api/auth/config', (route) => route.fulfill({ json: { googleClientId: 'test-client-id' } }));
    await context.route('**/accounts.google.com/gsi/client', (route) => route.abort());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/login');
    await expect(page.getByTestId('login-email-input')).toBeVisible();
    await expect(page.getByTestId('google-signin')).toBeHidden();
    expect(errors).toEqual([]);
    await context.close();
  });

  test('a new person gets one verified account, goes through onboarding, and comes back to it', async ({ browser }) => {
    const email = `tripos.test.${unique('new-google')}@gmail.com`;
    const context = await newContext(browser);
    await stubGoogle(context, { sub: unique('sub'), email, name: 'New Google' });
    const page = await context.newPage();
    await page.goto('/signup');
    await page.getByTestId('google-button').click();
    await expect(page).toHaveURL(/\/onboarding/);
    await finishOnboarding(page);
    await expect(page.getByTestId('verify-email-banner')).toHaveCount(0);
    const state = (await api(page, 'GET', '/state')).body;
    expect(state).toMatchObject({ emailVerified: true, mustConfirmEmail: false, hasPassword: false, user: { name: 'New Google', email } });
    const id = state.user.id;
    const trip = `trip-${unique('g')}`;
    expect((await api(page, 'POST', '/trips', { id: trip, name: 'Google Trip', destination: 'Goa', cover: COVER, startDate: '2030-01-01', endDate: '2030-01-02' })).status).toBe(201);

    await test.step('signing out and in again reaches the same account', async () => {
      await page.getByTestId('sidebar-account-menu-button').click();
      await page.getByTestId('account-menu-sign-out').click();
      await expect(page).toHaveURL(/\/login/);
      await page.getByTestId('google-button').click();
      await page.getByTestId('dashboard-welcome').waitFor();
      const after = (await api(page, 'GET', '/state')).body;
      expect(after.user.id).toBe(id);
      expect(after.trips.map((t: { id: string }) => t.id)).toContain(trip);
    });

    await test.step('and that address can\'t then sign up with a password as a second account', async () => {
      const other = await newContext(browser);
      const signup = await other.request.post('/api/auth/signup', { data: { name: 'Second Try', email, password: 'correct-horse' } });
      expect(signup.status()).toBe(409);
      expect((await signup.json()).message).toContain('Sign in with Google');
      const login = await other.request.post('/api/auth/login', { data: { email, password: 'correct-horse' } });
      expect(login.status()).toBe(401);
      expect((await login.json()).message).toContain('Sign in with Google');
      await other.close();
    });

    await test.step('Settings explains there\'s no password to change', async () => {
      await page.goto('/app/settings');
      await page.getByTestId('settings-tab-account').click();
      await expect(page.getByTestId('settings-password-google-note')).toBeVisible();
      await expect(page.getByTestId('settings-password-save-button')).toHaveCount(0);
    });

    await test.step('a password can be added by email, and then both ways reach the same account', async () => {
      const other = await newContext(browser);
      expect((await other.request.post('/api/auth/forgot-password', { data: { email } })).status()).toBe(200);
      const link = (await emailText(email, 'Reset your TripOS password')).match(/reset-password\/([\w-]+)/)?.[1] as string;
      expect((await other.request.post('/api/auth/reset-password', { data: { token: link, password: 'a-new-password' } })).status()).toBe(200);
      expect((await other.request.post('/api/auth/login', { data: { email, password: 'a-new-password' } })).status()).toBe(200);
      expect((await (await other.request.get('/api/state')).json()).user.id).toBe(id);
      await other.close();
    });
    await context.close();
  });

  test('an existing password account with the same email stays one account, keeping all its data and its password', async ({ browser }) => {
    const email = `tripos.test.${unique('existing')}@gmail.com`;
    const context = await newContext(browser);
    const page = await context.newPage();
    await fillSignup(page, email, 'Original Name');
    await expect(page).toHaveURL(/\/confirm-email/);
    await page.goto(verifyLink(await emailText(email, 'Verify your TripOS email')));
    await page.getByTestId('verify-email-done').waitFor();
    await page.goto('/onboarding');
    await finishOnboarding(page);
    const before = (await api(page, 'GET', '/state')).body;
    const trip = `trip-${unique('keep')}`;
    await api(page, 'POST', '/trips', { id: trip, name: 'Kept Trip', destination: 'Goa', cover: COVER, startDate: '2030-01-01', endDate: '2030-01-02' });
    await api(page, 'PUT', `/trips/${trip}/expenses/exp-${unique('e')}`, { title: 'Kept expense', amount: 500, category: 'food', paidBy: before.user.id, date: '2030-01-01', splitType: 'equal', shares: [{ memberId: before.user.id, amount: 500 }] });

    const googleContext = await newContext(browser);
    await stubGoogle(googleContext, { sub: unique('sub'), email: email.toUpperCase(), name: 'Different Google Name' });
    const google = await googleContext.newPage();
    await google.goto('/login');
    await google.getByTestId('google-button').click();
    await google.getByTestId('dashboard-welcome').waitFor();
    const after = (await api(google, 'GET', '/state')).body;
    expect(after.user.id).toBe(before.user.id);
    expect(after.user.name).toBe('Original Name');
    expect(after.hasPassword).toBe(true);
    expect(after.onboarded).toBe(true);
    const kept = after.trips.find((t: { id: string }) => t.id === trip);
    expect(kept.expenses[0].title).toBe('Kept expense');
    await googleContext.close();

    await test.step('the password still works, and the first device stays signed in', async () => {
      const other = await newContext(browser);
      expect((await other.request.post('/api/auth/login', { data: { email, password: 'correct-horse' } })).status()).toBe(200);
      await other.close();
      expect((await api(page, 'GET', '/state')).status).toBe(200);
    });
    await context.close();
  });

  test('an account that never proved its address is taken back by its real owner, and the old password stops working', async ({ browser }) => {
    const email = `tripos.test.${unique('squatter')}@gmail.com`;
    const squatterContext = await newContext(browser);
    const squatter = await squatterContext.newPage();
    await fillSignup(squatter, email, 'Not The Owner');
    await expect(squatter).toHaveURL(/\/confirm-email/);

    const ownerContext = await newContext(browser);
    await stubGoogle(ownerContext, { sub: unique('sub'), email, name: 'Real Owner' });
    const owner = await ownerContext.newPage();
    await owner.goto('/login');
    await owner.getByTestId('google-button').click();
    await expect(owner).toHaveURL(/\/onboarding/);
    const state = (await api(owner, 'GET', '/state')).body;
    expect(state).toMatchObject({ emailVerified: true, hasPassword: false, mustConfirmEmail: false });

    expect((await api(squatter, 'GET', '/state')).status).toBe(401);
    const login = await squatterContext.request.post('/api/auth/login', { data: { email, password: 'correct-horse' } });
    expect(login.status()).toBe(401);
    await squatterContext.close();
    await ownerContext.close();
  });

  test('someone invited by email becomes that same person, and sees the invite', async ({ browser }) => {
    const inviterContext = await newContext(browser);
    const inviter = await inviterContext.newPage();
    const inviterEmail = `tripos.test.${unique('inviter')}@gmail.com`;
    await fillSignup(inviter, inviterEmail, 'The Inviter');
    await inviter.goto(verifyLink(await emailText(inviterEmail, 'Verify your TripOS email')));
    await inviter.getByTestId('verify-email-done').waitFor();
    await inviter.goto('/onboarding');
    await finishOnboarding(inviter);
    const invited = `tripos.test.${unique('invited')}@gmail.com`;
    const trip = `trip-${unique('inv')}`;
    expect((await api(inviter, 'POST', '/trips', { id: trip, name: 'Invited Trip', destination: 'Goa', cover: COVER, startDate: '2030-01-01', endDate: '2030-01-02', members: [{ email: invited }] })).status).toBe(201);

    const context = await newContext(browser);
    await stubGoogle(context, { sub: unique('sub'), email: invited, name: 'Invited Person' });
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByTestId('google-button').click();
    await expect(page).toHaveURL(/\/onboarding/);
    await finishOnboarding(page);
    await expect(page.getByTestId('dashboard-invitations')).toContainText('Invited Trip');
    expect((await api(page, 'GET', '/state')).body.user.name).toBe('Invited Person');
    await inviterContext.close();
    await context.close();
  });

  test('a Google address Google hasn\'t confirmed is refused, with a clear message', async ({ browser }) => {
    const email = `tripos.test.${unique('unverified')}@gmail.com`;
    const context = await newContext(browser);
    await stubGoogle(context, { sub: unique('sub'), email, email_verified: false });
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByTestId('google-button').click();
    await expect(page.getByTestId('google-signin-error')).toContainText('hasn\'t confirmed');
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test('the server refuses a made-up token', async ({ browser }) => {
    const context = await newContext(browser);
    const res = await context.request.post('/api/auth/google', { data: { credential: 'eyJhbGciOiJSUzI1NiJ9.e30.not-a-signature' } });
    expect([401, 503]).toContain(res.status());
    expect((await (await context.request.get('/api/state')).status())).toBe(401);
    await context.close();
  });
});
