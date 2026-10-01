import type { z } from 'zod';
import type { ApiErrorKey, ApiFailure } from '@/lib/api-client';
import { displayNameErrorKind } from '@/lib/display-name-error';

/** Keys of `profile.errors` in the i18n catalogs that only client-side validation produces. */
export type ProfileFieldErrorKey = 'displayNameRequired' | 'displayNameTooLong' | 'timeZoneInvalid';

export type ProfileField = 'displayName' | 'timeZone';

/** What a profile form shows: one message above the fields and/or one message per field. */
export interface ProfileFormErrors {
  /** A key of the `errors` namespace (a server failure, or a rule with no field of its own). */
  form?: ApiErrorKey;
  fields?: Partial<Record<ProfileField, ProfileFieldErrorKey>>;
}

function displayNameKey(issue: z.core.$ZodIssue, input: unknown): ProfileFieldErrorKey {
  if (issue.code === 'too_big') return 'displayNameTooLong';
  // The shared schema reports empty and too long with the same refinement; the value tells which.
  if (issue.code === 'custom' && typeof input === 'string') {
    return displayNameErrorKind(input) === 'required'
      ? 'displayNameRequired'
      : 'displayNameTooLong';
  }
  return 'displayNameRequired';
}

/**
 * Client-side mirror of `updateProfileRequestSchema`, mapped to catalog keys for instant feedback.
 * `input` is what was parsed, so an empty name and a too long one can be told apart.
 */
export function toProfileValidationErrors(
  error: z.ZodError,
  input: { displayName?: unknown },
): ProfileFormErrors {
  const errors: ProfileFormErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === 'displayName') {
      errors.fields = {
        ...errors.fields,
        displayName: errors.fields?.displayName ?? displayNameKey(issue, input.displayName),
      };
    } else if (field === 'timeZone') {
      errors.fields = { ...errors.fields, timeZone: 'timeZoneInvalid' };
    } else {
      errors.form ??= 'validationFailed';
    }
  }
  return errors;
}

/** A server failure is shown above the submitted form; the API never says which field. */
export function toProfileFailure(failure: ApiFailure): ProfileFormErrors {
  return { form: failure.messageKey };
}
