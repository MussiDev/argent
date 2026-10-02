import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { liveSessionCount, resetAttemptLimits } from './support/database';
import { emailLink, waitForEmails } from './support/mailpit';

const API_URL = 'http://localhost:4000';
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'another long passphrase';

const es = catalogs.es;
const en = catalogs.en;

/** A fresh address per test: the e2e database and the Mailpit inbox persist across runs. */
function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.argent.test`;
}

async function register(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/es/register');
  await page.getByLabel(es.auth.fields.displayName).fill('Ana Pérez');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByLabel(es.auth.fields.password).fill(password);
  await page.getByRole('button', { name: es.auth.register.submit }).click();
}

async function registerAndVerify(page: Page, email: string): Promise<void> {
  await register(page, email);
  await expect(page.getByRole('heading', { name: es.auth.checkYourEmail.title })).toBeVisible();
  await page.goto((await emailLink(email, 'verify-email')).toString());
  await expect(
    page.getByRole('heading', { name: es.auth.verifyEmail.verifiedTitle }),
  ).toBeVisible();
}

async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/es/sign-in');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByLabel(es.auth.fields.password).fill(password);
  await page.getByRole('button', { name: es.auth.signIn.submit }).click();
}

/** The refresh cookie is scoped to `/auth`, so it is only visible for URLs under that path. */
async function sessionCookieNames(context: BrowserContext): Promise<string[]> {
  return (await context.cookies([API_URL, `${API_URL}/auth/refresh`])).map((cookie) => cookie.name);
}

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

test.beforeEach(async () => {
  await resetAttemptLimits();
});

test('register, verify through the email link, sign in and sign out (AC-01, AC-05, AC-07, AC-12)', async ({
  page,
  context,
}) => {
  const email = uniqueEmail('happy');

  await register(page, email);
  await expect(page).toHaveURL(/\/es\/check-your-email$/);
  await expect(page.getByRole('heading', { name: es.auth.checkYourEmail.title })).toBeVisible();

  const link = await emailLink(email, 'verify-email');
  expect(link.pathname).toBe('/es/verify-email');
  const response = await page.goto(link.toString());
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(
    page.getByRole('heading', { name: es.auth.verifyEmail.verifiedTitle }),
  ).toBeVisible();
  // The token does not stay in the address bar or the history entry.
  expect(new URL(page.url()).search).toBe('');

  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  await expect(page.getByRole('button', { name: es.auth.signOut.label })).toBeVisible();
  // `__Host-`/`Secure` cookies are accepted over http://localhost (a secure context in Chromium).
  const cookies = await context.cookies(API_URL);
  expect(cookies.find((cookie) => cookie.name === '__Host-argent_at')).toMatchObject({
    secure: true,
    httpOnly: true,
    sameSite: 'Strict',
  });
  const session = await page.request.get(`${API_URL}/auth/session`);
  expect(session.status()).toBe(200);
  expect(await session.json()).toMatchObject({
    user: {
      email,
      emailVerified: true,
      language: 'es',
      timeZone: expect.stringMatching(/Cordoba/),
    },
  });

  await page.getByRole('button', { name: es.auth.signOut.label }).click();
  await expect(page).toHaveURL(/\/es\/sign-in$/);
  expect(await sessionCookieNames(context)).not.toContain('__Host-argent_at');
  expect(await sessionCookieNames(context)).not.toContain('__Secure-argent_rt');

  await page.goto('/es');
  await expect(page).toHaveURL(/\/es\/sign-in$/);
});

test('a short password is rejected naming the 10-character rule (AC-02)', async ({ page }) => {
  await register(page, uniqueEmail('short'), 'short123');

  await expect(page.getByText(es.errors.passwordTooShort)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/register$/);
});

test('registering without a display name keeps the visitor on the form with the required message (AC-04)', async ({
  page,
}) => {
  await page.goto('/es/register');
  await page.getByLabel(es.auth.fields.email).fill(uniqueEmail('noname'));
  await page.getByLabel(es.auth.fields.password).fill(PASSWORD);
  await page.getByRole('button', { name: es.auth.register.submit }).click();

  await expect(page.getByText(es.errors.displayNameRequired)).toBeVisible();
  const name = page.getByLabel(es.auth.fields.displayName);
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/es\/register$/);
});

test('a rejected password moves focus to the field and exposes its error', async ({ page }) => {
  await register(page, uniqueEmail('focus'), 'short123');

  const password = page.getByLabel(es.auth.fields.password);
  await expect(password).toBeFocused();
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  // The description also carries the field's hint; the error must be part of it.
  const description = await password.evaluate((input) =>
    (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' '),
  );
  expect(description).toContain(es.errors.passwordTooShort);
  // Every id the field points at exists, and the form never shows the browser's own messages.
  const describedBy = (await password.getAttribute('aria-describedby')) ?? '';
  for (const id of describedBy.split(' ').filter(Boolean)) {
    await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
  }
  await expect(page.locator('form')).toHaveAttribute('novalidate', '');
});

test('a breached password is rejected naming the breach rule (AC-02)', async ({ page }) => {
  await register(page, uniqueEmail('breached'), 'password123');

  await expect(page.getByText(es.errors.passwordBreached)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/register$/);
});

test('registering an existing email shows the same confirmation (AC-03)', async ({ page }) => {
  const email = uniqueEmail('existing');
  await register(page, email);
  await expect(page.getByRole('heading', { name: es.auth.checkYourEmail.title })).toBeVisible();

  await register(page, email, 'a different long password');

  await expect(page).toHaveURL(/\/es\/check-your-email$/);
  await expect(page.getByRole('heading', { name: es.auth.checkYourEmail.title })).toBeVisible();
  await expect(page.getByText(es.auth.checkYourEmail.description)).toBeVisible();
});

test('an unverified user entering the app is sent to the verify screen with resend (AC-04)', async ({
  page,
}) => {
  const email = uniqueEmail('unverified');
  await register(page, email);
  await waitForEmails(email, 1);

  await signIn(page, email);
  await expect(page).toHaveURL(/\/es\/check-your-email$/);

  await page.goto('/es');
  await expect(page).toHaveURL(/\/es\/check-your-email$/);
  await page.getByRole('button', { name: es.auth.checkYourEmail.resend }).click();
  await expect(page.getByText(es.auth.checkYourEmail.resent)).toBeVisible();
  await waitForEmails(email, 2);
});

test('a reused verification link shows the invalid-link error with resend (AC-06)', async ({
  page,
}) => {
  const email = uniqueEmail('reused-verify');
  await registerAndVerify(page, email);
  const link = await emailLink(email, 'verify-email');

  await page.goto(link.toString());

  await expect(page.getByText(es.errors.tokenInvalid)).toBeVisible();
  await expect(page.getByRole('button', { name: es.auth.verifyEmail.resend })).toBeVisible();
});

test('a wrong password shows the generic invalid-credentials error (AC-08)', async ({ page }) => {
  const email = uniqueEmail('wrong-password');
  await register(page, email);
  await expect(page.getByRole('heading', { name: es.auth.checkYourEmail.title })).toBeVisible();

  await signIn(page, email, 'not the right password');
  await expect(page.getByText(es.errors.invalidCredentials)).toBeVisible();
  expect(es.errors.invalidCredentials).toBe('Email o contraseña incorrectos');

  await signIn(page, uniqueEmail('unknown'), 'not the right password');
  await expect(page.getByText(es.errors.invalidCredentials)).toBeVisible();
  await expect(page).toHaveURL(/\/es\/sign-in$/);
});

test('two tabs refreshing an expired access token together stay signed in (no false theft)', async ({
  page,
  context,
}) => {
  const email = uniqueEmail('tabs');
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  const other = await context.newPage();
  // Without the access cookie both tabs must refresh, and they share one refresh cookie.
  await context.clearCookies({ name: '__Host-argent_at' });
  // Hold refresh requests so that two of them, if the tabs send two, reach the API together
  // with the same token: the race is forced instead of left to timing.
  const held: Route[] = [];
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    clearTimeout(releaseTimer);
    for (const route of held.splice(0)) void route.continue();
  };
  await context.route(`${API_URL}/auth/refresh`, (route) => {
    held.push(route);
    if (held.length >= 2) release();
    else releaseTimer = setTimeout(release, 2_000);
  });

  await Promise.all([page.goto('/es'), other.goto('/es')]);

  for (const tab of [page, other]) {
    await expect(tab.getByRole('button', { name: es.auth.signOut.label })).toBeVisible();
    await expect(tab).toHaveURL(/\/es$/);
  }
  expect(await sessionCookieNames(context)).toContain('__Secure-argent_rt');
  expect(await liveSessionCount(email)).toBe(1);
});

test('forgot password, reset through the email link and lose the old session (AC-09, AC-10)', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('reset');
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page.getByRole('button', { name: es.auth.signOut.label })).toBeVisible();

  const other = await browser.newContext({ locale: 'es-AR' });
  const resetPage = await other.newPage();
  await resetPage.goto('/es/forgot-password');
  await resetPage.getByLabel(es.auth.fields.email).fill(email);
  await resetPage.getByRole('button', { name: es.auth.forgotPassword.submit }).click();
  await expect(resetPage.getByText(es.auth.forgotPassword.sent)).toBeVisible();

  const link = await emailLink(email, 'reset-password', 2);
  const response = await resetPage.goto(link.toString());
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  await resetPage.getByLabel(es.auth.fields.newPassword).fill(NEW_PASSWORD);
  await resetPage.getByRole('button', { name: es.auth.resetPassword.submit }).click();
  await expect(
    resetPage.getByRole('heading', { name: es.auth.resetPassword.successTitle }),
  ).toBeVisible();
  await other.close();

  // The session started before the reset is gone.
  await page.goto('/es');
  await expect(page).toHaveURL(/\/es\/sign-in$/);

  await signIn(page, email);
  await expect(page.getByText(es.errors.invalidCredentials)).toBeVisible();
  await signIn(page, email, NEW_PASSWORD);
  await expect(page.getByRole('button', { name: es.auth.signOut.label })).toBeVisible();
});

test('an unknown email gets the same reset confirmation (AC-09)', async ({ page }) => {
  await page.goto('/es/forgot-password');
  await page.getByLabel(es.auth.fields.email).fill(uniqueEmail('nobody'));
  await page.getByRole('button', { name: es.auth.forgotPassword.submit }).click();

  await expect(page.getByText(es.auth.forgotPassword.sent)).toBeVisible();
});

test('a used reset link shows the invalid-link error and keeps the password (AC-11)', async ({
  page,
}) => {
  const email = uniqueEmail('reused-reset');
  // Reset emails only go to verified accounts (Block 5).
  await registerAndVerify(page, email);
  await page.goto('/es/forgot-password');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByRole('button', { name: es.auth.forgotPassword.submit }).click();
  await expect(page.getByText(es.auth.forgotPassword.sent)).toBeVisible();
  const link = await emailLink(email, 'reset-password', 2);

  await page.goto(link.toString());
  await page.getByLabel(es.auth.fields.newPassword).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: es.auth.resetPassword.submit }).click();
  await expect(
    page.getByRole('heading', { name: es.auth.resetPassword.successTitle }),
  ).toBeVisible();

  await page.goto(link.toString());
  await page.getByLabel(es.auth.fields.newPassword).fill('yet another long password');
  await page.getByRole('button', { name: es.auth.resetPassword.submit }).click();

  await expect(page.getByText(es.errors.tokenInvalid)).toBeVisible();
  await expect(
    page.getByRole('link', { name: es.auth.resetPassword.requestNewLink }),
  ).toBeVisible();
  await signIn(page, email, 'yet another long password');
  await expect(page.getByText(es.errors.invalidCredentials)).toBeVisible();
});

test.describe('in an English browser', () => {
  test.use({ locale: 'en-US', timezoneId: 'America/New_York' });

  test('stores language en and shows English screens (AC-21, NFR-10)', async ({ page }) => {
    const email = uniqueEmail('english');

    await page.goto('/');
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await page.getByRole('link', { name: en.auth.signIn.registerLink }).click();
    await expect(page).toHaveURL(/\/en\/register$/);
    await page.getByLabel(en.auth.fields.displayName).fill('Ana Pérez');
    await page.getByLabel(en.auth.fields.email).fill(email);
    await page.getByLabel(en.auth.fields.password).fill(PASSWORD);
    await page.getByRole('button', { name: en.auth.register.submit }).click();
    await expect(page.getByRole('heading', { name: en.auth.checkYourEmail.title })).toBeVisible();

    const link = await emailLink(email, 'verify-email');
    expect(link.pathname).toBe('/en/verify-email');
    await page.goto(link.toString());
    await expect(
      page.getByRole('heading', { name: en.auth.verifyEmail.verifiedTitle }),
    ).toBeVisible();

    await page.goto('/en/sign-in');
    await page.getByLabel(en.auth.fields.email).fill(email);
    await page.getByLabel(en.auth.fields.password).fill(PASSWORD);
    await page.getByRole('button', { name: en.auth.signIn.submit }).click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByRole('button', { name: en.auth.signOut.label })).toBeVisible();

    const session = await page.request.get(`${API_URL}/auth/session`);
    expect(await session.json()).toMatchObject({ user: { language: 'en' } });
  });
});

const AUTH_SCREENS = [
  ['register', 'register', 'title'],
  ['sign-in', 'signIn', 'title'],
  ['forgot-password', 'forgotPassword', 'title'],
  ['reset-password', 'resetPassword', 'title'],
  ['verify-email', 'verifyEmail', 'title'],
  ['check-your-email', 'checkYourEmail', 'title'],
] as const;

for (const locale of ['es', 'en'] as const) {
  for (const [path, screen, key] of AUTH_SCREENS) {
    test(`/${locale}/${path} renders in its language`, async ({ page }) => {
      const response = await page.goto(`/${locale}/${path}`);

      expect(response?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(
        page.getByRole('heading', { name: catalogs[locale].auth[screen][key] }),
      ).toBeVisible();
      const referrerPolicy = response?.headers()['referrer-policy'];
      if (path === 'verify-email' || path === 'reset-password') {
        expect(referrerPolicy).toBe('no-referrer');
      } else {
        expect(referrerPolicy).toBe('strict-origin-when-cross-origin');
      }
    });
  }
}
