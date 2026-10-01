import { expect, type Page } from '@playwright/test';
import { catalogs } from './catalogs';
import { emailLink } from './mailpit';

export const PASSWORD = 'correct horse battery staple';

const es = catalogs.es;

/** A fresh address per test: the e2e database and the Mailpit inbox persist across runs. */
export function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.argent.test`;
}

/** Registers through the form and opens the verification link from the email. */
export async function registerAndVerify(page: Page, email: string): Promise<void> {
  await page.goto('/es/register');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByLabel(es.auth.fields.password).fill(PASSWORD);
  await page.getByRole('button', { name: es.auth.register.submit }).click();
  await expect(page.getByRole('heading', { name: es.auth.checkYourEmail.title })).toBeVisible();
  await page.goto((await emailLink(email, 'verify-email')).toString());
  await expect(
    page.getByRole('heading', { name: es.auth.verifyEmail.verifiedTitle }),
  ).toBeVisible();
}

/** Signs in with the password form; the caller checks where it lands. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/es/sign-in');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByLabel(es.auth.fields.password).fill(PASSWORD);
  await page.getByRole('button', { name: es.auth.signIn.submit }).click();
}
