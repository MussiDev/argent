// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ForgotPasswordContainer } from '../src/features/auth/containers/forgot-password-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es } = CATALOGS;

async function requestReset(email: string) {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText(es.auth.fields.email), email);
  await user.click(screen.getByRole('button', { name: es.auth.forgotPassword.submit }));
}

describe('ForgotPasswordContainer', () => {
  it('requests the reset and replaces the form with the neutral confirmation (AC-09)', async () => {
    const { calls } = stubApi({
      'POST /auth/password-reset/request': {
        status: 202,
        body: { status: 'reset_sent_if_registered' },
      },
    });
    renderApp(<ForgotPasswordContainer />);

    await requestReset('ana@example.com');

    expect((await screen.findByRole('status')).textContent).toBe(es.auth.forgotPassword.sent);
    expect(screen.queryByLabelText(es.auth.fields.email)).toBeNull();
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/auth/password-reset/request',
        body: { email: 'ana@example.com' },
      },
    ]);
  });

  it('asks for the email without calling the API', async () => {
    const { calls } = stubApi({});
    renderApp(<ForgotPasswordContainer />);

    await requestReset('');

    expect(await screen.findByText(es.errors.emailRequired)).toBeDefined();
    expect(calls).toHaveLength(0);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(es.auth.fields.email));
    });
  });

  it('keeps the form and shows the retry-later message when rate limited', async () => {
    stubApi({
      'POST /auth/password-reset/request': { status: 429, body: { code: 'RATE_LIMITED' } },
    });
    renderApp(<ForgotPasswordContainer />);

    await requestReset('ana@example.com');

    expect(await screen.findByText(es.errors.retryLater)).toBeDefined();
    expect(screen.queryByText(es.auth.forgotPassword.sent)).toBeNull();
    expect(
      screen.getByRole('button', { name: es.auth.forgotPassword.submit }).hasAttribute('disabled'),
    ).toBe(false);
  });
});
