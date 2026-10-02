// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RegisterContainer } from '../src/features/auth/containers/register-container';
import { API_ORIGIN, CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;

async function fillAndSubmit(email: string, password: string, displayName = 'Ana') {
  const user = userEvent.setup();
  if (displayName) await user.type(screen.getByLabelText(es.auth.fields.displayName), displayName);
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

    await fillAndSubmit('  ana@example.com ', 'correct horse battery', '  Ana María ');

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/es/check-your-email');
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/auth/register' });
    // The shared schema trims the email and the display name; the device context travels with the credentials.
    expect(calls[0]?.body).toEqual({
      displayName: 'Ana María',
      email: 'ana@example.com',
      password: 'correct horse battery',
      timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
    });
  });

  it('validates client-side without calling the API and focuses the first invalid field', async () => {
    const { calls } = stubApi({});
    renderApp(<RegisterContainer />);

    await fillAndSubmit('', '', '');

    expect(await screen.findByText(es.errors.displayNameRequired)).toBeDefined();
    expect(screen.getByText(es.errors.emailRequired)).toBeDefined();
    expect(screen.getByText(es.errors.passwordRequired)).toBeDefined();
    expect(calls).toHaveLength(0);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(es.auth.fields.displayName));
    });
  });

  it('shows the display name field, required, before the email field (AC-04)', () => {
    stubApi({});
    renderApp(<RegisterContainer />);

    const name = screen.getByLabelText(es.auth.fields.displayName);
    const email = screen.getByLabelText(es.auth.fields.email);
    expect(name.hasAttribute('required')).toBe(true);
    expect(name.getAttribute('autocomplete')).toBe('name');
    expect(name.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
  ])('a display name that is %s sends no request and focuses the field', async (_label, name) => {
    const { calls } = stubApi({});
    renderApp(<RegisterContainer />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(es.auth.fields.email), 'ana@example.com');
    await user.type(screen.getByLabelText(es.auth.fields.password), 'correct horse battery');
    if (name) await user.type(screen.getByLabelText(es.auth.fields.displayName), name);
    await user.click(screen.getByRole('button', { name: es.auth.register.submit }));

    expect(await screen.findByText(es.errors.displayNameRequired)).toBeDefined();
    const field = screen.getByLabelText(es.auth.fields.displayName);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
    expect(calls).toHaveLength(0);
  });

  it('a display name of 51 characters shows the too-long message and sends no request', async () => {
    const { calls } = stubApi({});
    renderApp(<RegisterContainer />);

    await fillAndSubmit('ana@example.com', 'correct horse battery', 'a'.repeat(51));

    expect(await screen.findByText(es.errors.displayNameTooLong)).toBeDefined();
    expect(calls).toHaveLength(0);
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

    await user.type(screen.getByLabelText(en.auth.fields.displayName), 'Ana');
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
