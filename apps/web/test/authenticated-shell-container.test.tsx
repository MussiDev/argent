// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AuthenticatedShellContainer } from '../src/features/auth/containers/authenticated-shell-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es } = CATALOGS;

function session(emailVerified: boolean) {
  return {
    status: 200,
    body: {
      user: {
        id: 'u1',
        email: 'ana@example.com',
        emailVerified,
        language: 'es',
        timeZone: 'America/Argentina/Buenos_Aires',
      },
    },
  };
}

const UNAUTHENTICATED = { status: 401, body: { code: 'UNAUTHENTICATED' } };

function renderShell() {
  return renderApp(
    <AuthenticatedShellContainer>
      <p>private content</p>
    </AuthenticatedShellContainer>,
  );
}

describe('AuthenticatedShellContainer', () => {
  it('shows the app only after the API confirms a verified session', async () => {
    const { calls } = stubApi({ 'GET /auth/session': session(true) });
    renderShell();

    expect(screen.getByRole('status').textContent).toBe(es.app.loading);
    expect(screen.queryByText('private content')).toBeNull();

    expect(await screen.findByText('private content')).toBeDefined();
    expect(screen.getByRole('button', { name: es.auth.signOut.label })).toBeDefined();
    expect(calls).toEqual([{ method: 'GET', path: '/auth/session', body: undefined }]);
  });

  it('refreshes an expired access token before deciding', async () => {
    const { calls } = stubApi({
      'GET /auth/session': [UNAUTHENTICATED, UNAUTHENTICATED, session(true)],
      'POST /auth/refresh': { status: 200, body: { status: 'refreshed' } },
    });
    const { router } = renderShell();

    expect(await screen.findByText('private content')).toBeDefined();
    expect(router.replace).not.toHaveBeenCalled();
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /auth/session',
      'GET /auth/session',
      'POST /auth/refresh',
      'GET /auth/session',
    ]);
  });

  it('sends a visitor without a session to sign-in', async () => {
    stubApi({ 'GET /auth/session': UNAUTHENTICATED, 'POST /auth/refresh': UNAUTHENTICATED });
    const { router } = renderShell();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(screen.queryByText('private content')).toBeNull();
  });

  it('sends an unverified account to "check your email" (AC-04)', async () => {
    stubApi({ 'GET /auth/session': session(false) });
    const { router } = renderShell();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/check-your-email');
    });
    expect(screen.queryByText('private content')).toBeNull();
  });

  it('offers a retry instead of signing out when the API is unreachable', async () => {
    stubApi({ 'GET /auth/session': ['network-error', session(true)] });
    const { router } = renderShell();

    expect(await screen.findByText(es.errors.network)).toBeDefined();
    expect(router.replace).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: es.app.retry }));

    expect(await screen.findByText('private content')).toBeDefined();
  });

  it('signs out and goes to sign-in', async () => {
    const { calls } = stubApi({
      'GET /auth/session': session(true),
      'POST /auth/sign-out': { status: 204 },
    });
    const { router } = renderShell();

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: es.auth.signOut.label }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(calls.at(-1)).toEqual({ method: 'POST', path: '/auth/sign-out', body: {} });
  });

  it('keeps the user in the app and shows why signing out failed', async () => {
    stubApi({ 'GET /auth/session': session(true), 'POST /auth/sign-out': 'network-error' });
    const { router } = renderShell();

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: es.auth.signOut.label }));

    expect(await screen.findByText(es.errors.network)).toBeDefined();
    expect(screen.getByText('private content')).toBeDefined();
    expect(router.replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: es.auth.signOut.label }).hasAttribute('disabled'),
    ).toBe(false);
  });
});
