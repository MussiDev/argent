// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RegisterContainer } from '../src/features/auth/containers/register-container';
import { API_ORIGIN, CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText(es.auth.fields.email), email);
  if (password) await user.type(screen.getByLabelText(es.auth.fields.password), password);
  await user.click(screen.getByRole('button', { name: es.auth.register.submit }));
}

describe('RegisterContainer', () => {
  it('registers with the device context and goes to "check your email"', async () => {
    const { calls } = stubApi({
      'POST /auth/register': { status: 202, body: { status: 'verification_sent' } },
    });
    const { router } = renderApp(<RegisterContainer />);

    await fillAndSubmit('  ana@example.com ', 'correct horse battery');

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/es/check-your-email');
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/auth/register' });
    // The shared schema trims the email; the device context travels with the credentials.
    expect(calls[0]?.body).toEqual({
      email: 'ana@example.com',
      password: 'correct horse battery',
      timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
    });
  });

  it('validates client-side without calling the API and focuses the first invalid field', async () => {
    const { calls } = stubApi({});
    renderApp(<RegisterContainer />);

    await fillAndSubmit('', '');

    expect(await screen.findByText(es.errors.emailRequired)).toBeDefined();
    expect(screen.getByText(es.errors.passwordRequired)).toBeDefined();
    expect(calls).toHaveLength(0);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(es.auth.fields.email));
    });
  });

  it('shows a too-short password on the password field', async () => {
    stubApi({ 'POST /auth/register': { status: 422, body: { code: 'PASSWORD_TOO_SHORT' } } });
    const { router } = renderApp(<RegisterContainer />);

    await fillAndSubmit('ana@example.com', 'short');

    expect(await screen.findByText(es.errors.passwordTooShort)).toBeDefined();
    const password = screen.getByLabelText(es.auth.fields.password);
    expect(password.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => {
      expect(document.activeElement).toBe(password);
    });
    expect(router.push).not.toHaveBeenCalled();
    // The submit button is usable again after the failure.
    expect(
      screen.getByRole('button', { name: es.auth.register.submit }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('shows an unreachable API above the form, in the screen language', async () => {
    stubApi({ 'POST /auth/register': 'network-error' });
    renderApp(<RegisterContainer />, { locale: 'en' });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(en.auth.fields.email), 'ana@example.com');
    await user.type(screen.getByLabelText(en.auth.fields.password), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: en.auth.register.submit }));

    expect(await screen.findByText(en.errors.network)).toBeDefined();
  });

  it('offers Google registration, starting in the device time zone and the screen language (FR-01)', () => {
    stubApi({});
    renderApp(<RegisterContainer />);

    const link = screen.getByRole('link', { name: es.auth.google.continue });
    const url = new URL(link.getAttribute('href') ?? '');
    expect(`${url.origin}${url.pathname}`).toBe(`${API_ORIGIN}/auth/google/start`);
    expect(url.searchParams.get('language')).toBe('es');
    expect(url.searchParams.get('timeZone')).toBe(
      new Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(screen.getByText(es.auth.or)).toBeDefined();
  });
});
