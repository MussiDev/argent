// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import AppLayout from '../src/app/[locale]/(app)/layout';
import HomePage from '../src/app/[locale]/(app)/page';
import CheckYourEmailPage from '../src/app/[locale]/(auth)/check-your-email/page';
import ForgotPasswordPage from '../src/app/[locale]/(auth)/forgot-password/page';
import AuthLayout from '../src/app/[locale]/(auth)/layout';
import RegisterPage from '../src/app/[locale]/(auth)/register/page';
import ResetPasswordPage from '../src/app/[locale]/(auth)/reset-password/page';
import SignInPage from '../src/app/[locale]/(auth)/sign-in/page';
import SecondFactorPage from '../src/app/[locale]/(auth)/sign-in/second-factor/page';
import ProfilePage from '../src/app/[locale]/(app)/settings/profile/page';
import SecurityPage from '../src/app/[locale]/(app)/settings/security/page';
import VerifyEmailPage from '../src/app/[locale]/(auth)/verify-email/page';
import { CATALOGS, renderApp, stubApi, VALID_TOKEN } from './support/render-app';

const { es } = CATALOGS;

const AUTH_PAGES: [string, ComponentType, string][] = [
  ['/register', RegisterPage, es.auth.register.title],
  ['/sign-in', SignInPage, es.auth.signIn.title],
  ['/forgot-password', ForgotPasswordPage, es.auth.forgotPassword.title],
  ['/reset-password', ResetPasswordPage, es.auth.resetPassword.title],
  ['/check-your-email', CheckYourEmailPage, es.auth.checkYourEmail.title],
  ['/verify-email', VerifyEmailPage, es.auth.verifyEmail.title],
  ['/sign-in/second-factor', SecondFactorPage, es.auth.secondFactor.title],
];

const SESSION = {
  status: 200,
  body: {
    user: {
      id: 'u1',
      email: 'ana@example.com',
      emailVerified: true,
      language: 'es',
      timeZone: 'UTC',
    },
  },
};

describe('routes', () => {
  it.each(AUTH_PAGES)('%s shows its screen inside the public auth layout', (path, Page, title) => {
    window.history.replaceState(null, '', `/es${path}?token=${VALID_TOKEN}`);
    stubApi({});
    renderApp(
      <AuthLayout>
        <Page />
      </AuthLayout>,
    );

    const heading = screen.getByRole('heading', { level: 1, name: title });
    expect(heading.closest('main')).not.toBeNull();
  });

  it('the home page is only shown behind the session guard', async () => {
    stubApi({ 'GET /auth/session': SESSION });
    renderApp(
      <AppLayout>
        <HomePage />
      </AppLayout>,
    );

    expect(screen.queryByRole('heading', { name: es.home.title })).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: es.home.title })).toBeDefined();
    expect(screen.getByText(es.home.tagline)).toBeDefined();
  });

  it('the security settings are only shown behind the session guard', async () => {
    const { calls } = stubApi({
      'GET /auth/session': SESSION,
      'GET /auth/2fa': { status: 200, body: { enabled: false, recoveryCodesRemaining: 0 } },
    });
    renderApp(
      <AppLayout>
        <SecurityPage />
      </AppLayout>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: es.security.title })).toBeDefined();
    expect(await screen.findByText(es.security.twoFactor.off)).toBeDefined();
    expect(calls.map((call) => call.path)).toEqual(['/auth/session', '/auth/2fa']);
  });

  it('the profile screen is only shown behind the session guard', async () => {
    const { calls } = stubApi({
      'GET /auth/session': SESSION,
      'GET /profile': {
        status: 200,
        body: {
          displayName: null,
          email: 'ana@example.com',
          twoFactorEnabled: false,
          preferences: {
            defaultRateType: 'blue',
            displayCurrency: 'ARS',
            timeZone: 'UTC',
            language: 'es',
          },
        },
      },
    });
    renderApp(
      <AppLayout>
        <ProfilePage />
      </AppLayout>,
    );

    expect(screen.queryByRole('heading', { name: es.profile.title })).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: es.profile.title })).toBeDefined();
    expect(await screen.findByLabelText(es.profile.account.displayName)).toBeDefined();
    expect(calls.map((call) => call.path)).toEqual(['/auth/session', '/profile']);
  });
});
