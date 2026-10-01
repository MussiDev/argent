// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SecondFactorContainer } from '../src/features/auth/containers/second-factor-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es } = CATALOGS;

function signedIn(emailVerified: boolean, language: 'es' | 'en') {
  return {
    status: 200,
    body: {
      status: 'signed_in',
      user: { id: 'u1', email: 'ana@example.com', emailVerified, language },
    },
  };
}

async function submitCode(code: string, label = es.auth.secondFactor.code) {
  const user = userEvent.setup();
  const input = screen.getByLabelText(label);
  await user.clear(input);
  await user.type(input, code);
  await user.click(screen.getByRole('button', { name: es.auth.secondFactor.submit }));
}

describe('SecondFactorContainer', () => {
  it("enters the app in the account's language with a valid code (AC-04)", async () => {
    const { calls } = stubApi({ 'POST /auth/2fa/verify': signedIn(true, 'en') });
    const { router } = renderApp(<SecondFactorContainer />);

    await submitCode('123456');

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en');
    });
    expect(calls).toEqual([{ method: 'POST', path: '/auth/2fa/verify', body: { code: '123456' } }]);
  });

  it('sends an unverified account to "check your email"', async () => {
    stubApi({ 'POST /auth/2fa/verify': signedIn(false, 'es') });
    const { router } = renderApp(<SecondFactorContainer />);

    await submitCode('123456');

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/check-your-email');
    });
  });

  it('accepts a recovery code after switching to it (AC-04)', async () => {
    const { calls } = stubApi({ 'POST /auth/2fa/verify': signedIn(true, 'es') });
    const { router } = renderApp(<SecondFactorContainer />);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.auth.secondFactor.useRecoveryCode }));
    await submitCode('abcde-fghij', es.auth.secondFactor.recoveryCode);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es');
    });
    expect(calls[0]?.body).toEqual({ code: 'abcde-fghij' });
  });

  it('refuses a wrong code with the invalid-code message and keeps the field focused (AC-05)', async () => {
    stubApi({ 'POST /auth/2fa/verify': { status: 401, body: { code: 'SECOND_FACTOR_INVALID' } } });
    const { router } = renderApp(<SecondFactorContainer />);

    await submitCode('000000');

    expect(await screen.findByText(es.errors.codeInvalid)).toBeDefined();
    expect(router.replace).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(es.auth.secondFactor.code));
    });
    expect(
      screen.getByRole('button', { name: es.auth.secondFactor.submit }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('sends the user back to sign-in when the challenge expired (sad path)', async () => {
    stubApi({ 'POST /auth/2fa/verify': { status: 401, body: { code: 'SECOND_FACTOR_EXPIRED' } } });
    const { router } = renderApp(<SecondFactorContainer />);

    await submitCode('123456');

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in?error=second_factor_expired');
    });
  });

  it('shows the retry-later message when rate limited (sad path)', async () => {
    stubApi({ 'POST /auth/2fa/verify': { status: 429, body: { code: 'RATE_LIMITED' } } });
    renderApp(<SecondFactorContainer />);

    await submitCode('123456');

    expect(await screen.findByText(es.errors.retryLater)).toBeDefined();
  });

  it('shows the retry-later message when 2FA is unavailable (sad path)', async () => {
    stubApi({
      'POST /auth/2fa/verify': { status: 503, body: { code: 'TWO_FACTOR_UNAVAILABLE' } },
    });
    const { router } = renderApp(<SecondFactorContainer />);

    await submitCode('123456');

    expect(await screen.findByText(es.errors.retryLater)).toBeDefined();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows the network message and stays when the API cannot be reached (sad path)', async () => {
    stubApi({ 'POST /auth/2fa/verify': 'network-error' });
    const { router } = renderApp(<SecondFactorContainer />);

    await submitCode('123456');

    expect(await screen.findByText(es.errors.network)).toBeDefined();
    expect(router.replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: es.auth.secondFactor.submit }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('rejects a malformed code before sending it (sad path)', async () => {
    const { calls } = stubApi({});
    renderApp(<SecondFactorContainer />);

    await submitCode('12345');

    expect(await screen.findByText(es.errors.totpCodeFormat)).toBeDefined();
    expect(calls).toHaveLength(0);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.auth.secondFactor.useRecoveryCode }));
    expect(screen.queryByText(es.errors.totpCodeFormat)).toBeNull();
    await submitCode('short', es.auth.secondFactor.recoveryCode);
    expect(await screen.findByText(es.errors.secondFactorCodeFormat)).toBeDefined();
    expect(calls).toHaveLength(0);
  });
});
