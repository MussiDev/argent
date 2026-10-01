import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import es from '../messages/es.json';
import { ForgotPasswordForm } from '../src/features/auth/components/forgot-password-form';
import { RegisterForm } from '../src/features/auth/components/register-form';
import { ResetPasswordForm } from '../src/features/auth/components/reset-password-form';
import { SignInForm } from '../src/features/auth/components/sign-in-form';
import type { FormErrors } from '../src/features/auth/form-errors';

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="es" timeZone="UTC" messages={es}>
      {element}
    </NextIntlClientProvider>,
  );
}

const noop = () => undefined;

const GOOGLE_START_URL = 'http://api.argent.test/auth/google/start?language=es';

const FORMS: [string, (errors: FormErrors) => ReactElement][] = [
  ['register', (errors) => <RegisterForm pending={false} errors={errors} onSubmit={noop} />],
  ['sign-in', (errors) => <SignInForm pending={false} errors={errors} onSubmit={noop} />],
  [
    'register with Google',
    (errors) => (
      <RegisterForm
        pending={false}
        errors={errors}
        onSubmit={noop}
        googleStartUrl={GOOGLE_START_URL}
      />
    ),
  ],
  [
    'sign-in with Google',
    (errors) => (
      <SignInForm
        pending={false}
        errors={errors}
        onSubmit={noop}
        googleStartUrl={GOOGLE_START_URL}
      />
    ),
  ],
  [
    'forgot-password',
    (errors) => <ForgotPasswordForm pending={false} errors={errors} onSubmit={noop} />,
  ],
  [
    'reset-password',
    (errors) => <ResetPasswordForm pending={false} errors={errors} onSubmit={noop} />,
  ],
];

const INVALID: FormErrors = {
  fields: {
    displayName: 'displayNameRequired',
    email: 'emailRequired',
    password: 'passwordTooShort',
    newPassword: 'passwordTooShort',
  },
};

function describedByIds(html: string): string[] {
  return [...html.matchAll(/aria-describedby="([^"]*)"/g)].flatMap(([, ids = '']) =>
    ids.split(' ').filter(Boolean),
  );
}

describe('auth form accessibility', () => {
  it.each(FORMS)('the %s form leaves validation messages to the catalogs', (_, form) => {
    const html = render(form({}));

    expect(html).toMatch(/<form[^>]* novalidate=""/i);
  });

  it.each(FORMS)('the %s form only points aria-describedby at ids that exist', (_, form) => {
    for (const errors of [{}, INVALID]) {
      const html = render(form(errors));

      for (const id of describedByIds(html)) {
        expect(html, `aria-describedby points at missing #${id}`).toContain(`id="${id}"`);
      }
    }
  });

  it('describes an invalid field with its error message', () => {
    const html = render(
      <RegisterForm
        pending={false}
        errors={{ fields: { password: 'passwordTooShort' } }}
        onSubmit={noop}
      />,
    );

    const input = /<input[^>]*name="password"[^>]*>/.exec(html)?.[0] ?? '';
    expect(input).toContain('aria-invalid="true"');
    const descriptions = describedByIds(input).map(
      (id) => new RegExp(`<p[^>]*id="${id}"[^>]*>([^<]*)</p>`).exec(html)?.[1],
    );
    expect(descriptions).toContain(es.errors.passwordTooShort);
  });

  it.each([
    ['sign-in', SignInForm],
    ['register', RegisterForm],
  ] as const)('the %s Google link is named by its label and hides the mark', (_, Form) => {
    const html = render(
      <Form pending={false} errors={{}} onSubmit={noop} googleStartUrl={GOOGLE_START_URL} />,
    );

    const link = /<a[^>]*href="([^"]*auth\/google\/start[^"]*)"[^>]*>(.*?)<\/a>/s.exec(html);
    expect(link?.[1]).toBe(GOOGLE_START_URL);
    expect(link?.[2]).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(link?.[2]?.replace(/<svg.*<\/svg>/s, '').trim()).toBe(es.auth.google.continue);
  });

  it('describes an invalid display name with its error message', () => {
    const html = render(
      <RegisterForm
        pending={false}
        errors={{ fields: { displayName: 'displayNameTooLong' } }}
        onSubmit={noop}
      />,
    );

    expect(html).toContain(`>${es.auth.fields.displayName}`);
    const input = /<input[^>]*name="displayName"[^>]*>/.exec(html)?.[0] ?? '';
    expect(input).toContain('aria-invalid="true"');
    const descriptions = describedByIds(input).map(
      (id) => new RegExp(`<p[^>]*id="${id}"[^>]*>([^<]*)</p>`).exec(html)?.[1],
    );
    expect(descriptions).toContain(es.errors.displayNameTooLong);
  });
});
