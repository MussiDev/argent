import type { z } from 'zod';
import type { ApiErrorKey, ApiFailure } from '@/lib/api-client';
import { displayNameErrorKind } from '@/lib/display-name-error';

/** Keys of the `errors` catalog namespace that only client-side validation produces. */
export type FieldErrorKey =
  | 'displayNameRequired'
  | 'displayNameTooLong'
  | 'emailRequired'
  | 'emailTooLong'
  | 'passwordRequired'
  | 'passwordTooLong'
  | 'passwordTooShort'
  | 'passwordBreached'
  | 'totpCodeFormat'
  | 'secondFactorCodeFormat';

/** Keys of the `errors` catalog namespace for what the API reports through a redirect URL. */
export type RedirectErrorKey = 'googleFailed' | 'secondFactorExpired';

export type ErrorMessageKey = ApiErrorKey | FieldErrorKey | RedirectErrorKey;

export type AuthField = 'displayName' | 'email' | 'password' | 'newPassword' | 'code';

/** What a form shows: one message above the fields and/or one message per field. */
export interface FormErrors {
  form?: ErrorMessageKey;
  fields?: Partial<Record<AuthField, ErrorMessageKey>>;
}

/**
 * Failed password rules are shown on the password field and a refused 2FA code on the code field
 * (which gets the focus back); anything else above the form.
 */
export function toFormErrors(
  failure: ApiFailure,
  passwordField: AuthField = 'password',
): FormErrors {
  if (failure.code === 'PASSWORD_TOO_SHORT' || failure.code === 'PASSWORD_BREACHED') {
    return { fields: { [passwordField]: failure.messageKey } };
  }
  if (failure.code === 'TOTP_INVALID' || failure.code === 'SECOND_FACTOR_INVALID') {
    return { fields: { code: failure.messageKey } };
  }
  return { form: failure.messageKey };
}

/** What a form submitted, to tell apart issues the schema reports with the same code. */
export type SubmittedValues = Readonly<{ displayName?: unknown }>;

function fieldKey(
  field: AuthField,
  issue: z.core.$ZodIssue,
  codeError: FieldErrorKey,
  submitted: SubmittedValues,
): ErrorMessageKey {
  if (field === 'code') return codeError;
  if (field === 'displayName') {
    const value = submitted.displayName;
    return typeof value === 'string' && displayNameErrorKind(value) === 'tooLong'
      ? 'displayNameTooLong'
      : 'displayNameRequired';
  }
  const missing = issue.code === 'too_small' || issue.code === 'invalid_type';
  if (field === 'email') return missing ? 'emailRequired' : 'emailTooLong';
  return missing ? 'passwordRequired' : 'passwordTooLong';
}

const FIELDS: readonly string[] = ['displayName', 'email', 'password', 'newPassword', 'code'];

function isAuthField(value: unknown): value is AuthField {
  return typeof value === 'string' && FIELDS.includes(value);
}

/**
 * Client-side mirror of the API's validation: the same shared Zod schema, mapped to catalog keys
 * for instant feedback. Issues outside the known fields (e.g. a malformed token) are form-level.
 * `submitted` is what was parsed, so an empty display name and a too long one can be told apart;
 * `codeError` says what a malformed 2FA code must look like on that screen.
 */
export function toValidationErrors(
  error: z.ZodError,
  submitted: SubmittedValues = {},
  codeError: FieldErrorKey = 'secondFactorCodeFormat',
): FormErrors {
  const errors: FormErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (isAuthField(field)) {
      errors.fields = {
        ...errors.fields,
        [field]: errors.fields?.[field] ?? fieldKey(field, issue, codeError, submitted),
      };
    } else if (field === 'token') {
      errors.form = 'tokenInvalid';
    } else {
      errors.form ??= 'validationFailed';
    }
  }
  return errors;
}
