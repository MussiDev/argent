import { formatMoney } from '@pesly/shared';
import { expect, test, type Page } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import { emailLink } from './support/mailpit';

const API_URL = 'http://localhost:4000';
const PASSWORD = 'correct horse battery staple';
const PRIVATE_ACCOUNT = 'Cuenta privada';

const es = catalogs.es;
const t = es.accounts;

/** What the screens print for an amount in minor units, from the same formatter the app uses. */
function money(minor: bigint, currency: 'ARS' | 'USD'): string {
  return formatMoney(minor, currency, 'es');
}

/** A fresh address per test: the e2e database and the Mailpit inbox persist across runs. */
function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.argent.test`;
}

async function signedInUser(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await page.goto('/es/register');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByLabel(es.auth.fields.password).fill(PASSWORD);
  await page.getByRole('button', { name: es.auth.register.submit }).click();
  await expect(page.getByRole('heading', { name: es.auth.checkYourEmail.title })).toBeVisible();
  await page.goto((await emailLink(email, 'verify-email')).toString());
  await expect(
    page.getByRole('heading', { name: es.auth.verifyEmail.verifiedTitle }),
  ).toBeVisible();
  await page.goto('/es/sign-in');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByLabel(es.auth.fields.password).fill(PASSWORD);
  await page.getByRole('button', { name: es.auth.signIn.submit }).click();
  await expect(page).toHaveURL(/\/es$/);
  return email;
}

interface NewAccount {
  name: string;
  type: keyof typeof t.types;
  currency: 'ARS' | 'USD';
  /** Typed as is, in the es notation; left out to keep the pre-filled value. */
  openingBalance?: string;
}

async function fillAccountForm(page: Page, account: NewAccount): Promise<void> {
  await page.goto('/es/accounts/new');
  await page.getByLabel(t.fields.name).fill(account.name);
  await page.getByLabel(t.fields.type).selectOption({ label: t.types[account.type] });
  await page.getByLabel(t.fields.currency).selectOption({ label: t.currencies[account.currency] });
  if (account.openingBalance !== undefined) {
    await page.getByLabel(t.fields.openingBalance).fill(account.openingBalance);
  }
  await page.getByRole('button', { name: t.form.submit }).click();
}

async function createAccount(page: Page, account: NewAccount): Promise<void> {
  await fillAccountForm(page, account);
  await expect(page).toHaveURL(/\/es\/accounts$/);
  await expect(row(page, account.name)).toBeVisible();
}

function row(page: Page, name: string) {
  return page.getByRole('listitem', { name, exact: true });
}

function rowButton(page: Page, action: string, name: string) {
  return row(page, name).getByRole('button', { name: `${action} ${name}`, exact: true });
}

function total(page: Page, label: string) {
  // The markup is a description list: the amount is the <dd> that follows the currency's <dt>.
  return page
    .getByRole('group', { name: t.list.totals })
    .locator('dt', { hasText: label })
    .locator('xpath=following-sibling::dd[1]');
}

// The flows must not trip over console errors or API failures that no test expects.
const consoleErrors: string[] = [];
let unexpectedStatuses: string[] = [];
let allowedStatuses: number[] = [];

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

/** Records console errors and unexpected API statuses of `page` into the shared lists. */
function guard(page: Page): void {
  page.on('console', (message) => {
    // A refused request is also logged by the browser; it is judged by its status below.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  page.on('response', (response) => {
    if (
      response.url().startsWith(API_URL) &&
      response.status() >= 400 &&
      !allowedStatuses.includes(response.status()) &&
      // Signed-out probes of the session endpoint answer 401 before sign-in, by design.
      !response.url().includes('/auth/')
    ) {
      unexpectedStatuses.push(`${response.status()} ${response.url()}`);
    }
  });
}

test.beforeEach(async ({ page }) => {
  await resetAttemptLimits();
  consoleErrors.length = 0;
  unexpectedStatuses = [];
  allowedStatuses = [];
  guard(page);
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
  expect(unexpectedStatuses).toEqual([]);
});

test('an ARS and a USD account show their balances and the totals (AC-01, AC-11, AC-12)', async ({
  page,
}) => {
  await signedInUser(page, 'both-currencies');

  await createAccount(page, {
    name: 'Caja chica',
    type: 'cash',
    currency: 'ARS',
    openingBalance: '1.500,00',
  });
  await createAccount(page, {
    name: 'Dólares ahorro',
    type: 'savings',
    currency: 'USD',
    openingBalance: '200,50',
  });

  await expect(row(page, 'Caja chica')).toContainText(money(150_000n, 'ARS'));
  await expect(row(page, 'Caja chica')).toContainText(t.types.cash);
  await expect(row(page, 'Dólares ahorro')).toContainText(money(20_050n, 'USD'));
  await expect(row(page, 'Dólares ahorro')).toContainText(t.types.savings);
  await expect(total(page, t.totals.ARS)).toContainText(money(150_000n, 'ARS'));
  await expect(total(page, t.totals.USD)).toContainText(money(20_050n, 'USD'));
});

test('the opening balance is optional (0) and a negative one is accepted (AC-16, AC-17)', async ({
  page,
}) => {
  await signedInUser(page, 'opening-balance');

  await page.goto('/es/accounts/new');
  await expect(page.getByLabel(t.fields.openingBalance)).toHaveValue('0');

  await createAccount(page, { name: 'En cero', type: 'bank_account', currency: 'ARS' });
  await createAccount(page, {
    name: 'Descubierto',
    type: 'bank_account',
    currency: 'ARS',
    openingBalance: '-250,50',
  });

  await expect(row(page, 'En cero')).toContainText(money(0n, 'ARS'));
  await expect(row(page, 'Descubierto')).toContainText(money(-25_050n, 'ARS'));
  await expect(total(page, t.totals.ARS)).toContainText(money(-25_050n, 'ARS'));
});

test('the form reports a missing name and offers the five account types (AC-02, AC-03)', async ({
  page,
}) => {
  await signedInUser(page, 'form-errors');
  await page.goto('/es/accounts/new');

  await expect(page.getByLabel(t.fields.type).locator('option')).toHaveText([
    t.fields.typePlaceholder,
    t.types.cash,
    t.types.bank_account,
    t.types.digital_wallet,
    t.types.credit_card,
    t.types.savings,
  ]);

  await page.getByRole('button', { name: t.form.submit }).click();

  await expect(page.getByText(t.errors.nameRequired)).toBeVisible();
  await expect(page.getByText(t.errors.typeRequired)).toBeVisible();
  await expect(page.getByText(t.errors.currencyRequired)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/accounts\/new$/);
});

test('the form refuses an opening balance beyond the limit and creates nothing (AC-18, AC-19)', async ({
  page,
}) => {
  await signedInUser(page, 'beyond-limit');

  await fillAccountForm(page, {
    name: 'Demasiado',
    type: 'savings',
    currency: 'ARS',
    openingBalance: '10.000.000.000.000,01',
  });

  const message = t.errors.amountOutOfRange.replace('{max}', money(10n ** 15n, 'ARS'));
  await expect(page.getByText(message)).toBeVisible();
  await expect(page.getByLabel(t.fields.openingBalance)).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/es\/accounts\/new$/);

  await page.goto('/es/accounts');
  await expect(page.getByText(t.list.empty)).toBeVisible();
  await expect(row(page, 'Demasiado')).toHaveCount(0);
});

test('the form refuses a name with only zero-width characters and creates nothing (AC-21)', async ({
  page,
}) => {
  await signedInUser(page, 'invisible-name');

  await fillAccountForm(page, { name: '\u200B\u200B', type: 'cash', currency: 'ARS' });

  await expect(page.getByText(t.errors.nameRequired)).toBeVisible();
  await expect(page.getByLabel(t.fields.name)).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/es\/accounts\/new$/);

  await page.goto('/es/accounts');
  await expect(page.getByText(t.list.empty)).toBeVisible();
});

test('the form refuses a name with a hidden character next to text (AC-20)', async ({ page }) => {
  await signedInUser(page, 'hidden-character');

  await fillAccountForm(page, { name: 'Caja\u200B', type: 'cash', currency: 'ARS' });

  await expect(page.getByText(t.errors.nameInvalidCharacters)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/accounts\/new$/);

  await page.goto('/es/accounts');
  await expect(page.getByText(t.list.empty)).toBeVisible();
});

test('rename, archive, unarchive and delete update the list (AC-06, AC-07, AC-08, AC-09)', async ({
  page,
}) => {
  await signedInUser(page, 'row-actions');
  await createAccount(page, {
    name: 'Billetera',
    type: 'digital_wallet',
    currency: 'ARS',
    openingBalance: '100,00',
  });

  await rowButton(page, t.actions.rename, 'Billetera').click();
  await page
    .getByLabel(t.actions.renameField.replace('{name}', 'Billetera'))
    .fill('Billetera nueva');
  await page.getByRole('button', { name: t.actions.save }).click();
  await expect(row(page, 'Billetera nueva')).toBeVisible();
  await expect(row(page, 'Billetera')).toHaveCount(0);

  await rowButton(page, t.actions.archive, 'Billetera nueva').click();
  await expect(row(page, 'Billetera nueva')).toHaveCount(0);
  await expect(page.getByText(t.list.empty)).toBeVisible();
  await expect(total(page, t.totals.ARS)).toContainText(money(0n, 'ARS'));

  await page.getByRole('button', { name: t.list.showArchived }).click();
  await expect(row(page, 'Billetera nueva')).toBeVisible();
  await rowButton(page, t.actions.unarchive, 'Billetera nueva').click();
  await expect(row(page, 'Billetera nueva')).toHaveCount(0);
  await expect(page.getByText(t.list.emptyArchived)).toBeVisible();

  await page.getByRole('button', { name: t.list.showActive }).click();
  await expect(row(page, 'Billetera nueva')).toBeVisible();
  await expect(total(page, t.totals.ARS)).toContainText(money(10_000n, 'ARS'));

  await rowButton(page, t.actions.delete, 'Billetera nueva').click();
  await expect(
    page.getByText(t.actions.confirmDelete.replace('{name}', 'Billetera nueva')),
  ).toBeVisible();
  await page.getByRole('button', { name: t.actions.confirmDeleteYes }).click();
  await expect(row(page, 'Billetera nueva')).toHaveCount(0);
  await expect(page.getByText(t.list.empty)).toBeVisible();

  await page.reload();
  await expect(page.getByText(t.list.empty)).toBeVisible();
});

test('a duplicate name shows an error message (AC-13)', async ({ page }) => {
  await signedInUser(page, 'duplicate');
  await createAccount(page, { name: 'Sueldo', type: 'bank_account', currency: 'ARS' });
  allowedStatuses = [409];

  // Names are unique per owner regardless of case.
  await fillAccountForm(page, { name: 'sueldo', type: 'cash', currency: 'USD' });

  await expect(page.getByText(es.errors.accountNameTaken)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/accounts\/new$/);
});

test("a second user never sees the first user's accounts (AC-15)", async ({ page, browser }) => {
  await signedInUser(page, 'owner');
  await createAccount(page, {
    name: PRIVATE_ACCOUNT,
    type: 'savings',
    currency: 'ARS',
    openingBalance: '999,00',
  });

  const other = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  try {
    const otherPage = await other.newPage();
    guard(otherPage);
    await signedInUser(otherPage, 'stranger');
    await otherPage.goto('/es/accounts');

    await expect(otherPage.getByText(t.list.empty)).toBeVisible();
    await expect(otherPage.getByText(PRIVATE_ACCOUNT)).toHaveCount(0);
    await expect(total(otherPage, t.totals.ARS)).toContainText(money(0n, 'ARS'));
  } finally {
    await other.close();
  }

  await page.goto('/es/accounts');
  await expect(row(page, PRIVATE_ACCOUNT)).toBeVisible();
});
