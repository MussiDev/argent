// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  CheckYourEmailContainer,
  VerifyEmailContainer,
} from '../src/features/auth/containers/verify-email-container';
import { CATALOGS, renderApp, stubApi, VALID_TOKEN } from './support/render-app';

const { es } = CATALOGS;

const RESENT = { status: 202, body: { status: 'verification_sent' } };
const UNAUTHENTICATED = { status: 401, body: { code: 'UNAUTHENTICATED' } };

describe('VerifyEmailContainer', () => {
  it('posts the token from the link once, removes it from the URL and confirms', async () => {
    window.history.replaceState(null, '', `/es/verify-email?token=${VALID_TOKEN}`);
    const { calls } = stubApi({
      'POST /auth/verify-email': { status: 200, body: { status: 'verified' } },
    });
    // Strict mode runs the effect twice, as React's development remount does.
    renderApp(<VerifyEmailContainer />, { strict: true });

    expect(screen.getByRole('status').textContent).toBe(es.auth.verifyEmail.verifying);
    expect(
      await screen.findByRole('heading', { name: es.auth.verifyEmail.verifiedTitle }),
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: es.auth.verifyEmail.continue }).getAttribute('href'),
    ).toBe('/es');
    expect(window.location.search).toBe('');
    expect(calls).toEqual([
      { method: 'POST', path: '/auth/verify-email', body: { token: VALID_TOKEN } },
    ]);
  });

  it('fails without calling the API when the link has no valid token', () => {
    window.history.replaceState(null, '', '/es/verify-email?token=short');
    const { calls } = stubApi({});
    renderApp(<VerifyEmailContainer />);

    expect(screen.getByText(es.errors.tokenInvalid)).toBeDefined();
    expect(screen.getByRole('button', { name: es.auth.verifyEmail.resend })).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it('offers a new link when the API refuses the token, and sends it (AC-06)', async () => {
    window.history.replaceState(null, '', `/es/verify-email?token=${VALID_TOKEN}`);
    const { calls } = stubApi({
      'POST /auth/verify-email': { status: 400, body: { code: 'TOKEN_INVALID' } },
      'POST /auth/verification/resend': RESENT,
    });
    renderApp(<VerifyEmailContainer />);

    expect(await screen.findByText(es.errors.tokenInvalid)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: es.auth.verifyEmail.resend }));

    expect((await screen.findByRole('status')).textContent).toBe(es.auth.verifyEmail.resent);
    expect(calls.map((call) => call.path)).toEqual([
      '/auth/verify-email',
      '/auth/verification/resend',
    ]);
  });

  it('shows why resending failed instead of the token error', async () => {
    window.history.replaceState(null, '', `/es/verify-email?token=${VALID_TOKEN}`);
    stubApi({
      'POST /auth/verify-email': { status: 400, body: { code: 'TOKEN_INVALID' } },
      'POST /auth/verification/resend': { status: 429, body: { code: 'RATE_LIMITED' } },
    });
    renderApp(<VerifyEmailContainer />);

    await screen.findByText(es.errors.tokenInvalid);
    await userEvent.setup().click(screen.getByRole('button', { name: es.auth.verifyEmail.resend }));

    expect(await screen.findByText(es.errors.retryLater)).toBeDefined();
    expect(screen.queryByText(es.errors.tokenInvalid)).toBeNull();
    expect(
      screen.getByRole('button', { name: es.auth.verifyEmail.resend }).hasAttribute('disabled'),
    ).toBe(false);
  });
});

describe('CheckYourEmailContainer', () => {
  it('resends the verification email and confirms it', async () => {
    const { calls } = stubApi({ 'POST /auth/verification/resend': RESENT });
    renderApp(<CheckYourEmailContainer />);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.auth.checkYourEmail.resend }));

    expect((await screen.findByRole('status')).textContent).toBe(es.auth.checkYourEmail.resent);
    expect(calls).toEqual([{ method: 'POST', path: '/auth/verification/resend', body: {} }]);
  });

  it('sends a user without a session to sign in first', async () => {
    const { calls } = stubApi({
      'POST /auth/verification/resend': UNAUTHENTICATED,
      'POST /auth/refresh': UNAUTHENTICATED,
    });
    const { router } = renderApp(<CheckYourEmailContainer />);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.auth.checkYourEmail.resend }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(calls.map((call) => call.path)).toContain('/auth/refresh');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a network failure and lets the user try again', async () => {
    stubApi({ 'POST /auth/verification/resend': 'network-error' });
    const { router } = renderApp(<CheckYourEmailContainer />);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.auth.checkYourEmail.resend }));

    expect(await screen.findByText(es.errors.network)).toBeDefined();
    expect(router.push).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: es.auth.checkYourEmail.resend }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('links back to sign-in', () => {
    stubApi({});
    renderApp(<CheckYourEmailContainer />, { locale: 'en' });

    expect(
      screen
        .getByRole('link', { name: CATALOGS.en.auth.checkYourEmail.backToSignIn })
        .getAttribute('href'),
    ).toBe('/en/sign-in');
  });
});
