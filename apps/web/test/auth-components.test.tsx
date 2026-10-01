// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedShell } from '../src/features/auth/components/authenticated-shell';
import { SignOutButton } from '../src/features/auth/components/sign-out-button';
import {
  VerifyEmailNotice,
  VerifyEmailStatus,
} from '../src/features/auth/components/verify-email-notice';
import { CATALOGS, renderApp } from './support/render-app';

const { es, en } = CATALOGS;

function isDisabled(name: string): boolean {
  return screen.getByRole('button', { name }).hasAttribute('disabled');
}

describe('SignOutButton', () => {
  it('signs out on click', async () => {
    const onSignOut = vi.fn();
    renderApp(<SignOutButton pending={false} onSignOut={onSignOut} />);

    await userEvent.setup().click(screen.getByRole('button', { name: es.auth.signOut.label }));

    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('is disabled and says so while signing out', () => {
    renderApp(<SignOutButton pending onSignOut={vi.fn()} />, { locale: 'en' });

    expect(isDisabled(en.auth.signOut.pending)).toBe(true);
    expect(screen.queryByRole('button', { name: en.auth.signOut.label })).toBeNull();
  });
});

describe('AuthenticatedShell', () => {
  const handlers = () => ({ onRetry: vi.fn(), onSignOut: vi.fn() });

  it('announces the session check and hides the app meanwhile', () => {
    renderApp(
      <AuthenticatedShell
        state={{ kind: 'loading' }}
        signingOut={false}
        signOutError={undefined}
        {...handlers()}
      >
        <p>private content</p>
      </AuthenticatedShell>,
    );

    expect(screen.getByRole('status').textContent).toBe(es.app.loading);
    expect(screen.queryByText('private content')).toBeNull();
  });

  it('shows why the session check failed and retries on demand', async () => {
    const { onRetry, onSignOut } = handlers();
    renderApp(
      <AuthenticatedShell
        state={{ kind: 'failed', error: 'retryLater' }}
        signingOut={false}
        signOutError={undefined}
        onRetry={onRetry}
        onSignOut={onSignOut}
      >
        <p>private content</p>
      </AuthenticatedShell>,
    );

    expect(screen.getByText(es.errors.retryLater)).toBeDefined();
    expect(screen.queryByText('private content')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: es.app.retry }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows the app with a sign-out button and any sign-out error', () => {
    renderApp(
      <AuthenticatedShell
        state={{ kind: 'ready' }}
        signingOut
        signOutError="network"
        {...handlers()}
      >
        <p>private content</p>
      </AuthenticatedShell>,
    );

    expect(screen.getByText('private content')).toBeDefined();
    expect(screen.getByText(es.errors.network)).toBeDefined();
    expect(isDisabled(es.auth.signOut.pending)).toBe(true);
  });

  it('links to the security settings, the profile and home in the current locale', () => {
    renderApp(
      <AuthenticatedShell
        state={{ kind: 'ready' }}
        signingOut={false}
        signOutError={undefined}
        {...handlers()}
      >
        <p>private content</p>
      </AuthenticatedShell>,
      { locale: 'en' },
    );

    expect(screen.getByRole('link', { name: en.app.nav.security }).getAttribute('href')).toBe(
      '/en/settings/security',
    );
    expect(screen.getByRole('link', { name: en.app.nav.profile }).getAttribute('href')).toBe(
      '/en/settings/profile',
    );
    expect(screen.getByRole('link', { name: en.app.nav.home }).getAttribute('href')).toBe('/en');
  });

  it.each([
    ['/settings/security', 'security'],
    ['/settings/profile', 'profile'],
    ['/', 'home'],
  ] as const)(
    'marks the link of the current page (%s) with aria-current',
    (currentPath, current) => {
      renderApp(
        <AuthenticatedShell
          state={{ kind: 'ready' }}
          currentPath={currentPath}
          signingOut={false}
          signOutError={undefined}
          {...handlers()}
        >
          <p>private content</p>
        </AuthenticatedShell>,
      );

      const security = screen.getByRole('link', { name: es.app.nav.security });
      const profile = screen.getByRole('link', { name: es.app.nav.profile });
      const home = screen.getByRole('link', { name: es.app.nav.home });
      expect(security.getAttribute('aria-current')).toBe(current === 'security' ? 'page' : null);
      expect(profile.getAttribute('aria-current')).toBe(current === 'profile' ? 'page' : null);
      expect(home.getAttribute('aria-current')).toBe(current === 'home' ? 'page' : null);
    },
  );
});

describe('VerifyEmailNotice', () => {
  it('resends on click', async () => {
    const onResend = vi.fn();
    renderApp(<VerifyEmailNotice resendStatus="idle" errors={{}} onResend={onResend} />);

    expect(screen.getByRole('heading', { name: es.auth.checkYourEmail.title })).toBeDefined();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.auth.checkYourEmail.resend }));
    expect(onResend).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is disabled while sending', () => {
    renderApp(<VerifyEmailNotice resendStatus="pending" errors={{}} onResend={vi.fn()} />);

    expect(isDisabled(es.auth.checkYourEmail.resending)).toBe(true);
  });

  it('confirms a sent email and shows form errors', () => {
    renderApp(
      <VerifyEmailNotice resendStatus="sent" errors={{ form: 'retryLater' }} onResend={vi.fn()} />,
    );

    expect(screen.getByRole('status').textContent).toBe(es.auth.checkYourEmail.resent);
    expect(screen.getByText(es.errors.retryLater)).toBeDefined();
  });
});

describe('VerifyEmailStatus', () => {
  it('announces the verification in progress without offering a resend', () => {
    renderApp(
      <VerifyEmailStatus status="verifying" resendStatus="idle" errors={{}} onResend={vi.fn()} />,
    );

    expect(screen.getByRole('status').textContent).toBe(es.auth.verifyEmail.verifying);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('continues into the app once verified', () => {
    renderApp(
      <VerifyEmailStatus status="verified" resendStatus="idle" errors={{}} onResend={vi.fn()} />,
      { locale: 'en' },
    );

    expect(screen.getByRole('heading', { name: en.auth.verifyEmail.verifiedTitle })).toBeDefined();
    expect(
      screen.getByRole('link', { name: en.auth.verifyEmail.continue }).getAttribute('href'),
    ).toBe('/en');
  });

  it('offers a new link after a failure, pending and sent', async () => {
    const onResend = vi.fn();
    const { rerender } = renderApp(
      <VerifyEmailStatus
        status="failed"
        resendStatus="idle"
        errors={{ form: 'tokenInvalid' }}
        onResend={onResend}
      />,
    );

    expect(screen.getByText(es.errors.tokenInvalid)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: es.auth.verifyEmail.resend }));
    expect(onResend).toHaveBeenCalledOnce();

    rerender(
      <VerifyEmailStatus status="failed" resendStatus="pending" errors={{}} onResend={onResend} />,
    );
    expect(isDisabled(es.auth.verifyEmail.resending)).toBe(true);

    rerender(
      <VerifyEmailStatus status="failed" resendStatus="sent" errors={{}} onResend={onResend} />,
    );
    expect(screen.getByRole('status').textContent).toBe(es.auth.verifyEmail.resent);
  });
});
