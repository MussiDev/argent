import {
  passwordResetConfirmRequestSchema,
  registerRequestSchema,
  signInRequestSchema,
} from '@argent/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { toFormErrors, toValidationErrors } from '../src/features/auth/form-errors';

function validationErrorsOf(schema: z.ZodType, input: unknown) {
  const parsed = schema.safeParse(input);
  if (parsed.success) throw new Error('expected the input to be invalid');
  return toValidationErrors(parsed.error);
}

describe('toFormErrors', () => {
  it.each(['PASSWORD_TOO_SHORT', 'PASSWORD_BREACHED'] as const)(
    'shows %s on the password field',
    (code) => {
      const messageKey = code === 'PASSWORD_TOO_SHORT' ? 'passwordTooShort' : 'passwordBreached';

      expect(toFormErrors({ ok: false, code, messageKey })).toEqual({
        fields: { password: messageKey },
      });
    },
  );

  it('uses the named password field (reset password)', () => {
    expect(
      toFormErrors(
        { ok: false, code: 'PASSWORD_TOO_SHORT', messageKey: 'passwordTooShort' },
        'newPassword',
      ),
    ).toEqual({ fields: { newPassword: 'passwordTooShort' } });
  });

  it.each([
    ['INVALID_CREDENTIALS', 'invalidCredentials'],
    ['TOKEN_INVALID', 'tokenInvalid'],
    ['NETWORK', 'network'],
  ] as const)('shows %s above the form', (code, messageKey) => {
    expect(toFormErrors({ ok: false, code, messageKey })).toEqual({ form: messageKey });
  });
});

describe('toValidationErrors', () => {
  it('reports missing email and password as required', () => {
    expect(validationErrorsOf(signInRequestSchema, { email: '   ', password: '' })).toEqual({
      fields: { email: 'emailRequired', password: 'passwordRequired' },
    });
  });

  it('reports absent fields (wrong type) as required', () => {
    expect(validationErrorsOf(signInRequestSchema, {})).toEqual({
      fields: { email: 'emailRequired', password: 'passwordRequired' },
    });
  });

  it('reports oversized email and password as too long', () => {
    expect(
      validationErrorsOf(signInRequestSchema, {
        email: 'a'.repeat(255),
        password: 'x'.repeat(129),
      }),
    ).toEqual({ fields: { email: 'emailTooLong', password: 'passwordTooLong' } });
  });

  it('keeps the first message of a field with several issues', () => {
    const error = new z.ZodError([
      {
        code: 'too_small',
        minimum: 1,
        origin: 'string',
        inclusive: true,
        path: ['password'],
        message: '',
        input: '',
      },
      {
        code: 'too_big',
        maximum: 1,
        origin: 'string',
        inclusive: true,
        path: ['password'],
        message: '',
        input: '',
      },
    ]);

    expect(toValidationErrors(error)).toEqual({ fields: { password: 'passwordRequired' } });
  });

  it('maps the new password of a reset like the password', () => {
    expect(
      validationErrorsOf(passwordResetConfirmRequestSchema, {
        token: 'A'.repeat(43),
        newPassword: '',
      }),
    ).toEqual({ fields: { newPassword: 'passwordRequired' } });
  });

  it('reports a malformed token as an invalid link, above the form', () => {
    expect(
      validationErrorsOf(passwordResetConfirmRequestSchema, {
        token: 'nope',
        newPassword: 'a brand new passphrase',
      }),
    ).toEqual({ form: 'tokenInvalid' });
  });

  it('reports issues outside the known fields as a generic validation failure', () => {
    expect(
      validationErrorsOf(registerRequestSchema, {
        email: 'ana@example.com',
        password: 'correct horse battery',
        timeZone: 'x'.repeat(65),
        language: 'y'.repeat(36),
      }),
    ).toEqual({ form: 'validationFailed' });
  });

  it('only produces keys that exist in both catalogs', () => {
    const keys = ['emailRequired', 'emailTooLong', 'passwordRequired', 'passwordTooLong'];
    for (const key of keys) {
      expect(es.errors).toHaveProperty(key);
      expect(en.errors).toHaveProperty(key);
    }
  });
});
