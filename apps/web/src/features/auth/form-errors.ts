import type { z } from 'zod';
import type { ApiErrorKey, ApiFailure } from '@/lib/api-client';

/** Keys of the `errors` catalog namespace that only client-side validation produces. */
export type FieldErrorKey =
  | 'emailRequired'
  | 'emailTooLong'
  | 'passwordRequired'
  | 'passwordTooLong'
  | 'passwordTooShort'
  | 'passwordBreached';

export type ErrorMessageKey = ApiErrorKey | FieldErrorKey;

export type AuthField = 'email' | 'password' | 'newPassword';

/** What a form shows: one message above the fields and/or one message per field. */
export interface FormErrors {
  form?: ErrorMessageKey;
  fields?: Partial<Record<AuthField, ErrorMessageKey>>;
}

/** Failed password rules are shown on the password field; anything else above the form. */
export function toFormErrors(
  failure: ApiFailure,
  passwordField: AuthField = 'password',
): FormErrors {
  if (failure.code === 'PASSWORD_TOO_SHORT' || failure.code === 'PASSWORD_BREACHED') {
    return { fields: { [passwordField]: failure.messageKey } };
  }
  return { form: failure.messageKey };
}

function fieldKey(field: AuthField, issue: z.core.$ZodIssue): ErrorMessageKey {
  const missing = issue.code === 'too_small' || issue.code === 'invalid_type';
  if (field === 'email') return missing ? 'emailRequired' : 'emailTooLong';
  return missing ? 'passwordRequired' : 'passwordTooLong';
}

const FIELDS: readonly string[] = ['email', 'password', 'newPassword'];

function isAuthField(value: unknown): value is AuthField {
  return typeof value === 'string' && FIELDS.includes(value);
}

/**
 * Client-side mirror of the API's validation: the same shared Zod schema, mapped to catalog keys
 * for instant feedback. Issues outside the known fields (e.g. a malformed token) are form-level.
 */
export function toValidationErrors(error: z.ZodError): FormErrors {
  const errors: FormErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (isAuthField(field)) {
      errors.fields = {
        ...errors.fields,
        [field]: errors.fields?.[field] ?? fieldKey(field, issue),
      };
    } else if (field === 'token') {
      errors.form = 'tokenInvalid';
    } else {
      errors.form ??= 'validationFailed';
    }
  }
  return errors;
}
