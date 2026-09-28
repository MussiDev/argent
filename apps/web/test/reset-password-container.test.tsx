// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ResetPasswordContainer } from '../src/features/auth/containers/reset-password-container';
import { CATALOGS, renderApp, stubApi, VALID_TOKEN } from './support/render-app';

const { es } = CATALOGS;

async function choosePassword(password: string) {
  const user = userEvent.setup();
  if (password) await user.type(screen.getByLabelText(es.auth.fields.newPassword), password);
  await user.click(screen.getByRole('button', { name: es.auth.resetPassword.submit }));
}

describe('ResetPasswordContainer', () => {
  it('takes the token out of the address bar and sends it with the new password', async () => {
    window.history.replaceState(null, '', `/es/reset-password?token=${VALID_TOKEN}#top`);
    const { calls } = stubApi({
      'POST /auth/password-reset/confirm': { status: 200, body: { status: 'password_updated' } },
    });
    // Strict mode remounts the effect: the token must be taken once, not lost on the second run.
    renderApp(<ResetPasswordContainer />, { strict: true });

    expect(window.location.pathname).toBe('/es/reset-password');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#top');
    expect(screen.queryByText(es.errors.tokenInvalid)).toBeNull();

    await choosePassword('a brand new passphrase');

    expect((await screen.findByRole('status')).textContent).toBe(es.auth.resetPassword.success);
    expect(
      screen.getByRole('link', { name: es.auth.resetPassword.signInLink }).getAttribute('href'),
    ).toBe('/es/sign-in');
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/auth/password-reset/confirm',
        body: { token: VALID_TOKEN, newPassword: 'a brand new passphrase' },
      },
    ]);
  });

  it('offers a new link instead of the form when the URL has no token (AC-11)', () => {
    window.history.replaceState(null, '', '/es/reset-password');
    stubApi({});
    renderApp(<ResetPasswordContainer />);

    expect(screen.getByText(es.errors.tokenInvalid)).toBeDefined();
    expect(
      screen.getByRole('link', { name: es.auth.resetPassword.requestNewLink }).getAttribute('href'),
    ).toBe('/es/forgot-password');
    expect(screen.queryByLabelText(es.auth.fields.newPassword)).toBeNull();
  });

  it('treats a malformed token as an invalid link without calling the API', async () => {
    window.history.replaceState(null, '', '/es/reset-password?token=not-a-token');
    const { calls } = stubApi({});
    renderApp(<ResetPasswordContainer />);

    await choosePassword('a brand new passphrase');

    expect(await screen.findByText(es.errors.tokenInvalid)).toBeDefined();
    expect(screen.getByRole('link', { name: es.auth.resetPassword.requestNewLink })).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it('asks for the new password without calling the API', async () => {
    window.history.replaceState(null, '', `/es/reset-password?token=${VALID_TOKEN}`);
    const { calls } = stubApi({});
    renderApp(<ResetPasswordContainer />);

    await choosePassword('');

    expect(await screen.findByText(es.errors.passwordRequired)).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it('shows a breached password on the new-password field', async () => {
    window.history.replaceState(null, '', `/es/reset-password?token=${VALID_TOKEN}`);
    stubApi({
      'POST /auth/password-reset/confirm': { status: 422, body: { code: 'PASSWORD_BREACHED' } },
    });
    renderApp(<ResetPasswordContainer />);

    await choosePassword('password1234');

    expect(await screen.findByText(es.errors.passwordBreached)).toBeDefined();
    const field = screen.getByLabelText(es.auth.fields.newPassword);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
  });

  it('offers a new link when the API refuses a used or expired token', async () => {
    window.history.replaceState(null, '', `/es/reset-password?token=${VALID_TOKEN}`);
    stubApi({
      'POST /auth/password-reset/confirm': { status: 400, body: { code: 'TOKEN_INVALID' } },
    });
    renderApp(<ResetPasswordContainer />);

    await choosePassword('a brand new passphrase');

    expect(
      await screen.findByRole('link', { name: es.auth.resetPassword.requestNewLink }),
    ).toBeDefined();
  });
});
