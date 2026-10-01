import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { catalogs, emailCatalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import { signInWithGoogle, uniqueSubject } from './support/fake-google';
import { emailLink, waitForSubject } from './support/mailpit';
import { TestAuthenticator, wrongCode } from './support/totp';

const PASSWORD = 'correct horse battery staple';
const RECOVERY_CODE = /^[0-9A-Z]{5}-[0-9A-Z]{5}$/;

const es = catalogs.es;

/** A fresh address per test: the e2e database and the Mailpit inbox persist across runs. */
function uniqueEmail(label: string, domain = 'e2e.argent.test'): string {
  return `2fa-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${domain}`;
}

async function registerAndVerify(page: Page, email: string): Promise<void> {
  await page.goto('/es/register');
  await page.getByLabel(es.auth.fields.displayName).fill('Ana Pérez');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByLabel(es.auth.fields.password).fill(PASSWORD);
  await page.getByRole('button', { name: es.auth.register.submit }).click();
  await expect(page.getByRole('heading', { name: es.auth.checkYourEmail.title })).toBeVisible();
  await page.goto((await emailLink(email, 'verify-email')).toString());
  await expect(
    page.getByRole('heading', { name: es.auth.verifyEmail.verifiedTitle }),
  ).toBeVisible();
}

async function signInWithPassword(page: Page, email: string): Promise<void> {
  await page.goto('/es/sign-in');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByLabel(es.auth.fields.password).fill(PASSWORD);
  await page.getByRole('button', { name: es.auth.signIn.submit }).click();
}

async function expectSignedIn(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/es$/);
  await expect(page.getByRole('button', { name: es.auth.signOut.label })).toBeVisible();
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: es.auth.signOut.label }).click();
  await expect(page).toHaveURL(/\/es\/sign-in$/);
}

async function expectSecondFactorScreen(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/es\/sign-in\/second-factor$/);
  await expect(
    page.getByRole('heading', { level: 1, name: es.auth.secondFactor.title }),
  ).toBeVisible();
}

async function submitSecondFactor(page: Page, code: string): Promise<void> {
  await page.getByLabel(es.auth.secondFactor.code).fill(code);
  await page.getByRole('button', { name: es.auth.secondFactor.submit }).click();
}

async function submitRecoveryCode(page: Page, code: string): Promise<void> {
  await page.getByRole('button', { name: es.auth.secondFactor.useRecoveryCode }).click();
  await page.getByLabel(es.auth.secondFactor.recoveryCode).fill(code);
  await page.getByRole('button', { name: es.auth.secondFactor.submit }).click();
}

async function openSecuritySettings(page: Page): Promise<void> {
  await page.getByRole('link', { name: es.app.nav.security }).click();
  await expect(page).toHaveURL(/\/es\/settings\/security$/);
  await expect(page.getByRole('heading', { level: 1, name: es.security.title })).toBeVisible();
}

interface Enrollment {
  authenticator: TestAuthenticator;
  recoveryCodes: string[];
}

/** The card of one settings view, found by its heading. */
function card(page: Page, title: string): Locator {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: title }) });
}

/** From the settings screen: starts the setup, confirms a code computed from the shown secret. */
async function enableTwoFactor(page: Page): Promise<Enrollment> {
  await page.getByRole('button', { name: es.security.twoFactor.enable }).click();
  const setup = card(page, es.security.setup.title);
  await expect(setup.getByRole('img', { name: es.security.setup.qrAlt })).toHaveAttribute(
    'src',
    /^data:image\/svg\+xml/,
  );
  const secret = (await setup.locator('code').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  const authenticator = new TestAuthenticator(secret);

  await page.getByLabel(es.security.setup.code).fill(await authenticator.nextCode());
  await page.getByRole('button', { name: es.security.setup.submit }).click();

  const codesCard = card(page, es.security.recoveryCodes.title);
  await expect(codesCard).toBeVisible();
  // The heading takes the focus, so screen readers announce the codes view.
  await expect(
    codesCard.getByRole('heading', { name: es.security.recoveryCodes.title }),
  ).toBeFocused();
  const recoveryCodes = (await codesCard.getByRole('listitem').allTextContents()).map((code) =>
    code.trim(),
  );
  return { authenticator, recoveryCodes };
}

async function confirmRecoveryCodesSaved(page: Page): Promise<void> {
  await page.getByRole('button', { name: es.security.recoveryCodes.done }).click();
  await expect(page.getByText(es.security.twoFactor.on)).toBeVisible();
}

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
// A TOTP code is accepted once per 30-second step, so a flow may wait for the next step.
test.describe.configure({ timeout: 120_000 });

test.beforeEach(async () => {
  await resetAttemptLimits();
});

test('enable 2FA: QR and secret, 10 recovery codes shown once, other sessions end, notice emailed (AC-01, AC-02, AC-07)', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('enable');
  await registerAndVerify(page, email);
  await signInWithPassword(page, email);
  await expectSignedIn(page);

  // Another device signed in to the same account.
  const otherContext = await browser.newContext({ locale: 'es-AR' });
  const other = await otherContext.newPage();
  await signInWithPassword(other, email);
  await expectSignedIn(other);

  await openSecuritySettings(page);
  await expect(page.getByText(es.security.twoFactor.off)).toBeVisible();
  const { recoveryCodes } = await enableTwoFactor(page);

  expect(recoveryCodes).toHaveLength(10);
  expect(new Set(recoveryCodes).size).toBe(10);
  for (const code of recoveryCodes) expect(code).toMatch(RECOVERY_CODE);

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: es.security.recoveryCodes.download }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(es.security.recoveryCodes.fileName);
  const file = await readFile(await download.path(), 'utf8');
  for (const code of recoveryCodes) expect(file).toContain(code);

  await confirmRecoveryCodesSaved(page);
  await expect(page.getByText(es.security.enabledNotice)).toBeVisible();
  await expect(page.getByText(recoveryCodes[0] ?? '')).toHaveCount(0);

  // Shown once: never again after a reload, and this browser stays signed in.
  await page.reload();
  await expect(page.getByText(es.security.twoFactor.on)).toBeVisible();
  await expect(page.getByRole('button', { name: es.auth.signOut.label })).toBeVisible();
  for (const code of recoveryCodes) await expect(page.getByText(code)).toHaveCount(0);

  // The other device is signed out.
  await other.goto('/es');
  await expect(other).toHaveURL(/\/es\/sign-in$/);
  await otherContext.close();

  await waitForSubject(email, emailCatalogs.es.two_factor_enabled.subject);
});

test('password sign-in asks for the second factor; wrong codes and a reused recovery code are refused (AC-04, AC-05)', async ({
  page,
}) => {
  const email = uniqueEmail('sign-in');
  await registerAndVerify(page, email);
  await signInWithPassword(page, email);
  await expectSignedIn(page);
  await openSecuritySettings(page);
  const { authenticator, recoveryCodes } = await enableTwoFactor(page);
  await confirmRecoveryCodesSaved(page);
  await signOut(page);

  // AC-04: no session after the password, then a valid code enters the app.
  await signInWithPassword(page, email);
  await expectSecondFactorScreen(page);
  await page.goto('/es');
  await expect(page).toHaveURL(/\/es\/sign-in$/);
  await signInWithPassword(page, email);
  await expectSecondFactorScreen(page);
  await submitSecondFactor(page, wrongCode(authenticator.secret));
  await expect(page.getByText(es.errors.codeInvalid)).toBeVisible();
  await expect(page.getByLabel(es.auth.secondFactor.code)).toBeFocused();
  await submitSecondFactor(page, await authenticator.nextCode());
  await expectSignedIn(page);
  await signOut(page);

  // AC-05: a recovery code enters once and is refused the second time.
  const [recoveryCode = ''] = recoveryCodes;
  await signInWithPassword(page, email);
  await expectSecondFactorScreen(page);
  await submitRecoveryCode(page, recoveryCode.toLowerCase());
  await expectSignedIn(page);
  await signOut(page);

  await signInWithPassword(page, email);
  await expectSecondFactorScreen(page);
  await submitRecoveryCode(page, recoveryCode);
  await expect(page.getByText(es.errors.codeInvalid)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/sign-in\/second-factor$/);
});

test('Google sign-in for a user with 2FA goes through the second-factor screen (AC-06)', async ({
  page,
}) => {
  const identity = {
    sub: uniqueSubject('2fa-google'),
    email: uniqueEmail('google', 'gmail.com'),
    emailVerified: true,
  };
  await signInWithGoogle(page, identity);
  await expectSignedIn(page);
  await openSecuritySettings(page);
  const { authenticator } = await enableTwoFactor(page);
  await confirmRecoveryCodesSaved(page);
  await signOut(page);

  await signInWithGoogle(page, identity);

  await expectSecondFactorScreen(page);
  await submitSecondFactor(page, await authenticator.nextCode());
  await expectSignedIn(page);
});

test('disable 2FA with a recovery code; the next sign-in has one step (AC-03)', async ({
  page,
}) => {
  const email = uniqueEmail('disable');
  await registerAndVerify(page, email);
  await signInWithPassword(page, email);
  await expectSignedIn(page);
  await openSecuritySettings(page);
  const { recoveryCodes } = await enableTwoFactor(page);
  await confirmRecoveryCodesSaved(page);

  await page.getByRole('button', { name: es.security.twoFactor.disable }).click();
  await page.getByLabel(es.security.disable.code).fill(recoveryCodes[1] ?? '');
  await page.getByRole('button', { name: es.security.disable.submit }).click();

  await expect(page.getByText(es.security.twoFactor.off)).toBeVisible();
  await expect(page.getByText(es.security.disabledNotice)).toBeVisible();
  await waitForSubject(email, emailCatalogs.es.two_factor_disabled.subject);
  await page.reload();
  await expect(page.getByText(es.security.twoFactor.off)).toBeVisible();
  await signOut(page);

  await signInWithPassword(page, email);
  await expectSignedIn(page);
});

test('a second step without a live challenge returns to sign-in with the expired message', async ({
  page,
}) => {
  await page.goto('/es/sign-in/second-factor');
  await submitSecondFactor(page, '123456');

  await expect(page).toHaveURL(/\/es\/sign-in$/);
  await expect(page.getByText(es.errors.secondFactorExpired)).toBeVisible();
});
