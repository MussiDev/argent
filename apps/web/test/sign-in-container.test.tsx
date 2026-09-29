// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SignInContainer } from '../src/features/auth/containers/sign-in-container';
import { API_ORIGIN, CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;

function signedIn(emailVerified: boolean, language: 'es' | 'en') {
  return {
    status: 200,
    body: { user: { id: 'u1', email: 'ana@example.com', emailVerified, language } },
  };
}

async function signInAs(email: string, password: string) {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText(es.auth.fields.email), email);
  if (password) await user.type(screen.getByLabelText(es.auth.fields.password), password);
  await user.click(screen.getByRole('button', { name: es.auth.signIn.submit }));
}

describe('SignInContainer', () => {
  it("opens the app in the account's language once signed in (FR-11)", async () => {
    const { calls } = stubApi({ 'POST /auth/sign-in': signedIn(true, 'en') });
    const { router } = renderApp(<SignInContainer />);

    await signInAs('ana@example.com', 'correct horse battery');

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en');
    });
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/auth/sign-in',
        body: { email: 'ana@example.com', password: 'correct horse battery' },
      },
    ]);
  });

  it('sends an unverified account to "check your email" (AC-04)', async () => {
    stubApi({ 'POST /auth/sign-in': signedIn(false, 'es') });
    const { router } = renderApp(<SignInContainer />);

    await signInAs('ana@example.com', 'correct horse battery');

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/check-your-email');
    });
  });

  it('shows invalid credentials above the form and stays on the screen', async () => {
    stubApi({ 'POST /auth/sign-in': { status: 401, body: { code: 'INVALID_CREDENTIALS' } } });
    const { router } = renderApp(<SignInContainer />);

    await signInAs('ana@example.com', 'wrong password');

    expect(await screen.findByText(es.errors.invalidCredentials)).toBeDefined();
    expect(router.replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: es.auth.signIn.submit }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('asks for the missing password without calling the API', async () => {
    const { calls } = stubApi({});
    renderApp(<SignInContainer />);

    await signInAs('ana@example.com', '');

    expect(await screen.findByText(es.errors.passwordRequired)).toBeDefined();
    expect(screen.queryByText(es.errors.emailRequired)).toBeNull();
    expect(calls).toHaveLength(0);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(es.auth.fields.password));
    });
  });

  it('links to password recovery and registration in the current locale', () => {
    stubApi({});
    renderApp(<SignInContainer />);

    expect(
      screen.getByRole('link', { name: es.auth.signIn.forgotPassword }).getAttribute('href'),
    ).toBe('/es/forgot-password');
    expect(
      screen.getByRole('link', { name: es.auth.signIn.registerLink }).getAttribute('href'),
    ).toBe('/es/register');
  });

  it('offers Google sign-in, starting in the device time zone and the screen language', () => {
    stubApi({});
    renderApp(<SignInContainer />, { locale: 'en' });

    const link = screen.getByRole('link', { name: en.auth.google.continue });
    const url = new URL(link.getAttribute('href') ?? '');
    expect(`${url.origin}${url.pathname}`).toBe(`${API_ORIGIN}/auth/google/start`);
    expect(url.searchParams.get('language')).toBe('en');
    expect(url.searchParams.get('timeZone')).toBe(
      new Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(screen.getByText(en.auth.or)).toBeDefined();
  });

  it('shows the Google error for error=google_failed and removes it from the URL (AC-02)', async () => {
    window.history.replaceState(null, '', '/es/sign-in?error=google_failed');
    const { calls } = stubApi({});
    renderApp(<SignInContainer />, { strict: true });

    expect(await screen.findByText(es.errors.googleFailed)).toBeDefined();
    expect(window.location.pathname).toBe('/es/sign-in');
    // A reload must not show the error again.
    expect(window.location.search).toBe('');
    expect(calls).toHaveLength(0);
  });

  it('clears the Google error once the user signs in with a password', async () => {
    window.history.replaceState(null, '', '/es/sign-in?error=google_failed');
    stubApi({ 'POST /auth/sign-in': { status: 401, body: { code: 'INVALID_CREDENTIALS' } } });
    renderApp(<SignInContainer />);
    expect(await screen.findByText(es.errors.googleFailed)).toBeDefined();

    await signInAs('ana@example.com', 'wrong password');

    expect(await screen.findByText(es.errors.invalidCredentials)).toBeDefined();
    expect(screen.queryByText(es.errors.googleFailed)).toBeNull();
  });

  it.each(['something_else', 'GOOGLE_FAILED', ''])(
    'ignores an unknown error value (%j) (sad path)',
    async (value) => {
      window.history.replaceState(null, '', `/es/sign-in?error=${value}`);
      stubApi({});
      renderApp(<SignInContainer />);

      await screen.findByRole('link', { name: es.auth.google.continue });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByText(es.errors.googleFailed)).toBeNull();
    },
  );
});
