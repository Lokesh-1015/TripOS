// Automatic exchange rates and totals across currencies. The rates are fixed here so the sums are exact.
import { expect, test, type Browser, type Page } from '@playwright/test';

const COVER = 'https://images.unsplash.com/photo-1614082242765-7c98ca0f3df3';
const RATES = { base: 'USD', updatedAt: '2026-11-02T00:00:00.000Z', rates: { INR: 100, USD: 1, EUR: 0.5, GBP: 0.8, AED: 4, SGD: 1.25, THB: 40 } };
const stamp = Date.now().toString(36);
let counter = 0;

async function newUser(browser: Browser, rates: 'available' | 'unavailable' = 'available') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.route('**/api/exchange-rates*', (route) => (rates === 'available' ? route.fulfill({ json: RATES }) : route.fulfill({ status: 503, json: { message: 'unavailable' } })));
  await page.goto('/signup');
  await page.getByTestId('signup-name-input').fill('Rate Tester');
  await page.getByTestId('signup-email-input').fill(`rates-${stamp}-${++counter}@example.test`);
  await page.getByTestId('signup-password-input').fill('correct-horse');
  await page.getByTestId('signup-submit-button').click();
  await page.getByTestId('onboarding-next-button').click();
  await page.getByTestId('onboarding-finish-button').click();
  await page.getByTestId('dashboard-welcome').waitFor();
  return { page, context };
}

async function createTrip(page: Page, currency: string, name: string) {
  const id = `trip-${stamp}-${++counter}`;
  const status = await page.evaluate(
    async (body) => (await fetch('/api/trips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status,
    { id, name, currency, destination: 'Goa', cover: COVER, startDate: '2030-03-01', endDate: '2030-03-04' },
  );
  expect(status).toBe(201);
  return id;
}

async function addExpense(page: Page, title: string, amount: string) {
  await page.getByTestId('expenses-add-button').click();
  await page.getByTestId('expense-title-input').fill(title);
  await page.getByTestId('expense-amount-input').fill(amount);
  await page.getByTestId('expense-save-button').click();
  await expect(page.getByTestId('expenses-history')).toContainText(title);
}

test('a foreign expense gets today\'s rate, which can be changed, and saved expenses keep theirs', async ({ browser }) => {
  const { page, context } = await newUser(browser);
  const id = await createTrip(page, 'INR', 'Rates Trip');
  await page.goto(`/app/trips/${id}/expenses`);

  await test.step('choosing a currency fills in the rate', async () => {
    await page.getByTestId('expenses-add-button').click();
    await page.getByTestId('expense-title-input').fill('Hotel');
    await page.getByTestId('expense-amount-input').fill('10');
    await page.getByTestId('expense-currency-select').click();
    await page.getByRole('option', { name: 'USD' }).click();
    await expect(page.getByTestId('expense-rate-input')).toHaveValue('100');
    await expect(page.getByTestId('expense-rate-source')).toContainText('Rates By Exchange Rate API');
    await expect(page.getByTestId('expense-dialog')).toContainText('Counts as ₹1,000');
  });

  await test.step('rates between other currencies go through the shared base', async () => {
    await page.getByTestId('expense-currency-select').click();
    await page.getByRole('option', { name: 'EUR' }).click();
    await expect(page.getByTestId('expense-rate-input')).toHaveValue('200');
  });

  await test.step('a rate someone typed is kept, and today\'s is one click away', async () => {
    await page.getByTestId('expense-rate-input').fill('190');
    await expect(page.getByTestId('expense-rate-input')).toHaveValue('190');
    await expect(page.getByTestId('expense-rate-today-button')).toContainText('200');
    await page.getByTestId('expense-rate-today-button').click();
    await expect(page.getByTestId('expense-rate-input')).toHaveValue('200');
    await page.getByTestId('expense-rate-input').fill('190');
    await expect(page.getByTestId('expense-dialog')).toContainText('Counts as ₹1,900');
    await page.getByTestId('expense-save-button').click();
    await expect(page.getByTestId('expenses-total-spent')).toHaveText('₹1,900');
  });

  await test.step('editing later keeps the rate it was paid at', async () => {
    await page.route('**/api/exchange-rates*', (route) => route.fulfill({ json: { ...RATES, rates: { ...RATES.rates, EUR: 0.25 } } }));
    await page.reload();
    await page.locator('[data-testid^="expense-row-"]').hover();
    await page.locator('[data-testid^="expense-edit-"]').click();
    await expect(page.getByTestId('expense-rate-input')).toHaveValue('190');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  await context.close();
});

test('converting a trip suggests today\'s rate', async ({ browser }) => {
  const { page, context } = await newUser(browser);
  const id = await createTrip(page, 'INR', 'Convert Trip');
  await page.goto(`/app/trips/${id}/expenses`);
  await addExpense(page, 'Dinner', '1000');
  await page.getByTestId('expenses-currency-select').click();
  await page.getByRole('option', { name: 'USD' }).click();
  await expect(page.getByTestId('convert-rate-input')).toHaveValue('0.01');
  await expect(page.getByTestId('convert-rate-source')).toContainText('Rates By Exchange Rate API');
  await page.getByTestId('convert-confirm-button').click();
  await expect(page.getByTestId('expenses-total-spent')).toHaveText('$10');
  await context.close();
});

test('the Expenses hub adds up trips in different currencies', async ({ browser }) => {
  const { page, context } = await newUser(browser);
  const inr = await createTrip(page, 'INR', 'India Trip');
  const usd = await createTrip(page, 'USD', 'USA Trip');
  await page.goto(`/app/trips/${inr}/expenses`);
  await addExpense(page, 'Train', '1000');
  await page.goto(`/app/trips/${usd}/expenses`);
  await addExpense(page, 'Taxi', '10');

  await page.goto('/app/expenses');
  await test.step('both trips count, in the person\'s own currency', async () => {
    await expect(page.getByTestId('hub-expenses-total')).toContainText('₹2,000');
    await expect(page.getByTestId('hub-expenses-total')).toContainText('Converted at today\'s rates');
    await expect(page.getByTestId('hub-expenses-rates-credit')).toContainText('Rates By Exchange Rate API');
    await expect(page.getByTestId('hub-expenses-owe')).toContainText('Across all trips');
  });
  await test.step('each trip still shows its own currency', async () => {
    await expect(page.locator(`[data-testid="hub-expense-trip-${inr}"]`)).toContainText('₹1,000');
    await expect(page.locator(`[data-testid="hub-expense-trip-${usd}"]`)).toContainText('$10');
  });
  await test.step('totals can be shown in another currency', async () => {
    await page.getByTestId('hub-expenses-currency-select').click();
    await page.getByRole('option', { name: 'USD' }).click();
    await expect(page.getByTestId('hub-expenses-total')).toContainText('$20');
  });
  await context.close();
});

test('with no rates, nothing is invented: suggestions step aside and totals list each currency', async ({ browser }) => {
  const { page, context } = await newUser(browser, 'unavailable');
  const inr = await createTrip(page, 'INR', 'India Trip');
  const usd = await createTrip(page, 'USD', 'USA Trip');
  await page.goto(`/app/trips/${inr}/expenses`);
  await addExpense(page, 'Train', '1000');
  await page.goto(`/app/trips/${usd}/expenses`);
  await addExpense(page, 'Taxi', '10');

  await page.getByTestId('expenses-add-button').click();
  await page.getByTestId('expense-currency-select').click();
  await page.getByRole('option', { name: 'INR' }).click();
  await expect(page.getByTestId('expense-rate-input')).toHaveValue('');
  await expect(page.getByTestId('expense-rate-source')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.goto('/app/expenses');
  await expect(page.getByTestId('hub-expenses-total')).toContainText('₹1,000 + $10');
  await expect(page.getByTestId('hub-expenses-total')).toContainText('rates aren\'t available');
  await context.close();
});
