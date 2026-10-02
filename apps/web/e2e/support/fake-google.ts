import { expect, type Page } from '@playwright/test';
// The login_hint format belongs to the fake server; importing it keeps both sides in step.
import {
  fakeGoogleLoginHint,
  type FakeGoogleIdentity,
} from '../../../api/test/fixtures/fake-google-oidc';
import { catalogs } from './catalogs';

export type { FakeGoogleIdentity };

/** Where `playwright.config.ts` runs the fake Google server: another site than localhost. */
export const FAKE_GOOGLE_ORIGIN = 'http://127.0.0.1:4100';

/** A fresh Google subject per test: the e2e database persists across runs. */
export function uniqueSubject(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * From `path` (sign-in or register), clicks "Continue with Google" and signs in on the fake
 * Google page as `identity`, stopping on its consent page. Waits for the link to carry the
 * device time zone, which the browser adds once the screen is hydrated.
 */
export async function reachGoogleConsent(
  page: Page,
  identity: FakeGoogleIdentity,
  { path = '/es/sign-in', locale = 'es' }: { path?: string; locale?: 'es' | 'en' } = {},
): Promise<void> {
  await page.goto(path);
  const link = page.getByRole('link', { name: catalogs[locale].auth.google.continue });
  await expect(link).toHaveAttribute('href', /[?&]timeZone=/);
  await link.click();
  await page.waitForURL(
    (url) => url.origin === FAKE_GOOGLE_ORIGIN && url.pathname === '/authorize',
  );
  await page.locator('input[name=login_hint]').fill(fakeGoogleLoginHint(identity));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#continue')).toBeVisible();
}

/** The whole Google flow; `choice` is the link clicked on the fake consent page. */
export async function signInWithGoogle(
  page: Page,
  identity: FakeGoogleIdentity,
  options: { path?: string; locale?: 'es' | 'en'; choice?: 'continue' | 'cancel' } = {},
): Promise<void> {
  await reachGoogleConsent(page, identity, options);
  await page.locator(`#${options.choice ?? 'continue'}`).click();
}

/**
 * From the delete-account screen of a signed-in user without a password: clicks "Continue with
 * Google to confirm", signs in on the fake Google page as `identity` and stops on its consent
 * page. Returns the query of the authorization request the fake Google server received, which is
 * the URL the browser was sent to, so a test can assert `prompt` and `max_age`.
 */
export async function reachGoogleReauthentication(
  page: Page,
  identity: FakeGoogleIdentity,
  { locale = 'es' }: { locale?: 'es' | 'en' } = {},
): Promise<Record<string, string>> {
  await page.goto(`/${locale}/settings/delete-account`);
  await page.getByRole('button', { name: catalogs[locale].deleteUser.google.continue }).click();
  await page.waitForURL(
    (url) => url.origin === FAKE_GOOGLE_ORIGIN && url.pathname === '/authorize',
  );
  const authorizationRequest = Object.fromEntries(new URL(page.url()).searchParams);
  await page.locator('input[name=login_hint]').fill(fakeGoogleLoginHint(identity));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#continue')).toBeVisible();
  return authorizationRequest;
}
