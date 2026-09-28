// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SignInContainer } from '../src/features/auth/containers/sign-in-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es } = CATALOGS;

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
});
