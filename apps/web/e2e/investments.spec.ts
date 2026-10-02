import { expect, test, type Locator, type Page } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import { registerAndVerify, signIn, uniqueEmail } from './support/accounts';

const API_URL = 'http://localhost:4000';
const PORTFOLIO = 'Balanz';

const es = catalogs.es;
const t = es.investments;

// Literal oracles, independent of the app's formatter; the screen puts a no-break space before the currency.
const NBSP = String.fromCharCode(0xa0);
const VALUE = `185.000,00${NBSP}ARS`;
const GAIN_AMOUNT = `+35.000,00${NBSP}ARS`;
const GAIN_PERCENT = '+23,33%';

async function signedInUser(page: Page, label: string): Promise<void> {
  const email = uniqueEmail(label);
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
}

function card(page: Page, name: string): Locator {
  return page.locator('section', {
    has: page.getByRole('heading', { name, exact: true, level: 2 }),
  });
}

async function createPortfolio(page: Page, name: string): Promise<void> {
  await page.getByLabel(t.forms.createPortfolio.name, { exact: true }).fill(name);
  await page.getByRole('button', { name: t.forms.createPortfolio.submit }).click();
  await expect(card(page, name)).toBeVisible();
}

interface NewHolding {
  ticker: string;
  instrumentName: string;
  quantity: string;
  totalCost?: string;
}

async function addHolding(page: Page, portfolio: string, holding: NewHolding): Promise<void> {
  const form = t.forms.addHolding;
  await card(page, portfolio).getByRole('button', { name: t.portfolio.addHolding }).click();
  await page.getByLabel(form.ticker, { exact: true }).fill(holding.ticker);
  await page.getByLabel(form.instrumentName, { exact: true }).fill(holding.instrumentName);
  await page
    .getByLabel(form.instrumentType, { exact: true })
    .selectOption({ label: t.instrumentTypes.cedear });
  await page.getByLabel(form.quantity, { exact: true }).fill(holding.quantity);
  await page.getByLabel(form.currency, { exact: true }).selectOption('ARS');
  if (holding.totalCost !== undefined) {
    await page.getByLabel(form.totalCost, { exact: true }).fill(holding.totalCost);
  }
  await page.getByRole('button', { name: form.submit }).click();
}

/** The singular branch of the ICU plural, e.g. "1 posición sin precio". */
const oneWithoutPrice = (
  /one \{([^}]*)\}/.exec(t.portfolio.holdingsWithoutPrice)?.[1] ?? ''
).replace('#', '1');

/** The holdings list of a portfolio; the totals list has another name. */
function holdingRows(page: Page, portfolio: string): Locator {
  return card(page, portfolio).getByRole('list', { name: t.portfolio.holdingsLabel }).locator('li');
}

// The flow must not trip over console errors or API failures that no test expects.
const consoleErrors: string[] = [];
let unexpectedStatuses: string[] = [];

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

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
  guard(page);
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
  expect(unexpectedStatuses).toEqual([]);
});

test('a portfolio goes from an unpriced holding to a valued, merged and deleted one (AC-01, AC-02, AC-03, AC-07, AC-10, AC-11, AC-16, AC-19, AC-21, AC-23)', async ({
  page,
  browser,
}) => {
  // One test on purpose: the steps share state (one user, one Mailpit registration); steps name the failing AC.
  const rows = holdingRows(page, PORTFOLIO);
  await signedInUser(page, 'investor');
  await test.step('AC-01 create a portfolio', async () => {
    await page.goto('/es/investments');
    await expect(page.getByRole('heading', { name: t.empty.title })).toBeVisible();

    await createPortfolio(page, PORTFOLIO);
    await expect(card(page, PORTFOLIO).getByText(t.portfolio.noHoldings)).toBeVisible();
  });

  await test.step('AC-02, AC-19, AC-21 add a holding and see it needs a price', async () => {
    await addHolding(page, PORTFOLIO, {
      ticker: 'AAPL',
      instrumentName: 'Apple',
      quantity: '10',
      totalCost: '150.000,00',
    });

    // Without a price the holding is not valued and the portfolio says how many are missing.
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(t.holding.priceNeeded);
    await expect(rows.first()).toContainText(t.holding.quantity.replace('{quantity}', '10'));
    expect(oneWithoutPrice).not.toBe('');
    await expect(card(page, PORTFOLIO)).toContainText(oneWithoutPrice);
  });

  await test.step('AC-07, AC-10, AC-11 set a price and see value and gain', async () => {
    await rows
      .first()
      .getByRole('button', { name: t.holding.showDetailsFor.replace('{ticker}', 'AAPL') })
      .click();
    await rows
      .first()
      .getByRole('button', { name: t.holding.setPriceFor.replace('{ticker}', 'AAPL') })
      .click();
    await page.getByLabel(t.forms.price.unitPrice, { exact: true }).fill('18500,00');
    await page.getByRole('button', { name: t.forms.price.submit }).click();

    const gain = t.holding.gain.replace('{amount}', GAIN_AMOUNT).replace('{percent}', GAIN_PERCENT);
    await expect(rows.first()).toContainText(VALUE);
    await expect(rows.first()).toContainText(gain);
    await expect(rows.first()).not.toContainText(t.holding.priceNeeded);
    await expect(
      card(page, PORTFOLIO).getByRole('list', { name: t.portfolio.totalsLabel }),
    ).toContainText(VALUE);
    expect(oneWithoutPrice).not.toBe('');
    await expect(card(page, PORTFOLIO)).not.toContainText(oneWithoutPrice);
  });

  await test.step('AC-23 the same ticker merges', async () => {
    // The same ticker in other letters merges into the existing holding.
    await addHolding(page, PORTFOLIO, { ticker: 'aapl', instrumentName: 'Apple', quantity: '5' });
    await expect(page.getByRole('status').filter({ hasText: 'AAPL' })).toContainText(
      t.notices.merged.replace('{ticker}', 'AAPL').replace('{quantity}', '15'),
    );
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(t.holding.quantity.replace('{quantity}', '15'));
  });

  await test.step('AC-03 a zero quantity is refused', async () => {
    // A quantity of zero is refused in the form and creates nothing.
    await addHolding(page, PORTFOLIO, {
      ticker: 'MSFT',
      instrumentName: 'Microsoft',
      quantity: '0',
    });
    await expect(page.getByText(t.errors.notPositive)).toBeVisible();
    await expect(page.getByLabel(t.forms.addHolding.quantity, { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await page.reload();
    await expect(rows).toHaveCount(1);
    await expect(card(page, PORTFOLIO)).not.toContainText('MSFT');
  });

  await test.step('AC-16 another user never sees the portfolio', async () => {
    // Another user never sees these portfolios.
    const other = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
    try {
      const otherPage = await other.newPage();
      guard(otherPage);
      await signedInUser(otherPage, 'stranger');
      await otherPage.goto('/es/investments');
      await expect(otherPage.getByRole('heading', { name: t.empty.title })).toBeVisible();
      await expect(otherPage.getByText(PORTFOLIO)).toHaveCount(0);
    } finally {
      await other.close();
    }
  });

  await test.step('delete asks for confirmation', async () => {
    // Deleting a portfolio asks for a second confirmation.
    await card(page, PORTFOLIO).getByRole('button', { name: t.portfolio.delete }).click();
    await expect(page.getByText(t.forms.confirmDelete.portfolio)).toBeVisible();
    await expect(card(page, PORTFOLIO)).toBeVisible();
    await page.getByRole('button', { name: t.forms.confirmDelete.confirm }).click();
    await expect(page.getByText(t.notices.deleted)).toBeVisible();
    await expect(page.getByRole('heading', { name: t.empty.title })).toBeVisible();
    await expect(page.getByText(PORTFOLIO)).toHaveCount(0);
  });
});
