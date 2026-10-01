import { updateProfileRequestSchema } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import {
  toProfileFailure,
  toProfileValidationErrors,
  type ProfileFormErrors,
} from '../src/features/profile/profile-errors';
import type { ApiFailure } from '../src/lib/api-client';

function validate(input: Record<string, unknown>): ProfileFormErrors {
  const parsed = updateProfileRequestSchema.safeParse(input);
  if (parsed.success) throw new Error('expected the input to be invalid');
  return toProfileValidationErrors(parsed.error, input);
}

describe('toProfileValidationErrors', () => {
  it.each([
    ['an empty name', ''],
    ['a whitespace-only name', '   '],
  ])('maps %s to displayNameRequired (AC-03)', (_label, displayName) => {
    expect(validate({ displayName })).toEqual({ fields: { displayName: 'displayNameRequired' } });
  });

  it.each([
    ['51 characters', 'a'.repeat(51)],
    ['51 emoji', '😀'.repeat(51)],
    ['more than the UTF-16 cap', 'a'.repeat(300)],
  ])('maps a name of %s to displayNameTooLong (AC-03)', (_label, displayName) => {
    expect(validate({ displayName })).toEqual({ fields: { displayName: 'displayNameTooLong' } });
  });

  it('maps a name that is not a string to displayNameRequired', () => {
    expect(validate({ displayName: 42 })).toEqual({
      fields: { displayName: 'displayNameRequired' },
    });
  });

  it('maps a time zone outside the IANA database to timeZoneInvalid (AC-08)', () => {
    expect(validate({ timeZone: 'Mars/Olympus' })).toEqual({
      fields: { timeZone: 'timeZoneInvalid' },
    });
  });

  it('maps any other invalid value to the generic form message', () => {
    expect(validate({ language: 'fr' })).toEqual({ form: 'validationFailed' });
    expect(validate({})).toEqual({ form: 'validationFailed' });
  });

  it('reports one key per field when several are invalid', () => {
    expect(validate({ displayName: '', timeZone: '+01:00' })).toEqual({
      fields: { displayName: 'displayNameRequired', timeZone: 'timeZoneInvalid' },
    });
  });
});

describe('toProfileFailure', () => {
  it.each([
    ['VALIDATION_FAILED', 'validationFailed'],
    ['NETWORK', 'network'],
    ['INTERNAL', 'unexpected'],
    ['UNAUTHENTICATED', 'unauthenticated'],
  ] as const)('shows a %s failure through its message key, above the form', (code, messageKey) => {
    const failure: ApiFailure = { ok: false, code, messageKey };
    expect(toProfileFailure(failure)).toEqual({ form: messageKey });
  });
});
