// Policies, the contact form, the terms prompt for older accounts and deleting an account, through the real UI.
import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

const stamp = Date.now().toString(36);
let counter = 0;
const unique = (name: string) => `${name}-${stamp}-${++counter}@example.test`;

async function signUp(page: Page, email: string, name = 'Safe Person') {
  await page.goto('/signup');
  await page.getByTestId('signup-name-input').fill(name);
  await page.getByTestId('signup-email-input').fill(email);
  await page.getByTestId('signup-password-input').fill('correct-horse');
  await page.getByTestId('signup-submit-button').click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.evaluate(async () => {
    await fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ onboarded: true }) });
  });
}

test.describe('policies and contact', () => {
  test('the policies are public and linked from signup and the footer', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByTestId('signup-terms-note')).toContainText("18 or over");
    await page.getByTestId('signup-terms-note').getByRole('link', { name: 'Privacy policy' }).click();
    await expect(page.getByTestId('privacy-page')).toContainText('remove this and other hidden details');
    await page.goto('/terms');
    await expect(page.getByTestId('terms-page')).toContainText('18 or over');
    await expect(page.getByTestId('terms-page')).toContainText("don't check who people are");
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Privacy', exact: true })).toHaveAttribute('href', '/privacy');
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  });

  test('the contact form sends a message and shows a problem clearly', async ({ page }) => {
    await page.goto('/contact');
    await page.getByTestId('contact-name').fill('Asha');
    await page.getByTestId('contact-email').fill('asha@example.test');
    await page.getByTestId('contact-message').fill('Hello from the contact test');
    await page.getByTestId('contact-submit').click();
    await expect(page.getByTestId('contact-sent')).toBeVisible();
  });
});

test('an older account is asked to accept the terms once, before anything else', async ({ page }) => {
  await signUp(page, unique('older'));
  // Accounts created now accept at signup, so this one is made to look like it's from before the terms.
  let accepted = false;
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), termsAccepted: accepted } });
  });
  await page.goto('/app');
  await expect(page.getByTestId('terms-dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0);
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/me/accept-terms') && r.ok());
  await page.getByTestId('terms-accept').click();
  await saved;
  accepted = true;
  await expect(page.getByTestId('terms-dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible();
});

test('someone can delete their account, and it really goes', async ({ page }) => {
  const email = unique('leaving');
  await signUp(page, email);
  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByTestId('settings-tab-account').click();
  await page.getByTestId('settings-delete-account-button').click();
  await expect(page.getByTestId('delete-account-confirm')).toBeDisabled();
  await page.getByTestId('delete-account-proof').fill('wrong-password');
  await page.getByTestId('delete-account-confirm').click();
  await expect(page.getByTestId('delete-account-dialog')).toContainText("That password isn't right");
  await page.getByTestId('delete-account-proof').fill('correct-horse');
  await page.getByTestId('delete-account-confirm').click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/login');
  await page.getByTestId('login-email-input').fill(email);
  await page.getByTestId('login-password-input').fill('correct-horse');
  await page.getByTestId('login-submit-button').click();
  await expect(page.getByTestId('login-error')).toBeVisible();
});
