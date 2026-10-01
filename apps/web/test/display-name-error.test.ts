import { registerRequestSchema } from '@argent/shared';
import { describe, expect, it } from 'vitest';
import { toValidationErrors } from '../src/features/auth/form-errors';
import { displayNameErrorKind } from '../src/lib/display-name-error';

describe('displayNameErrorKind', () => {
  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['tabs and newlines only', ' \t\n '],
  ])('returns required for a name that is %s', (_label, value) => {
    expect(displayNameErrorKind(value)).toBe('required');
  });

  it.each([
    ['51 characters', 'a'.repeat(51)],
    ['51 emoji', '😀'.repeat(51)],
    ['more than the UTF-16 cap', 'a'.repeat(300)],
    ['a NUL inside a name', 'Ana\u0000'],
  ])('returns tooLong for %s', (_label, value) => {
    expect(displayNameErrorKind(value)).toBe('tooLong');
  });
});

describe('toValidationErrors with a display name', () => {
  const base = {
    email: 'ana@example.com',
    password: 'correct horse battery',
    timeZone: 'America/Cordoba',
    language: 'es-AR',
  };

  function errorsFor(displayName: unknown) {
    const submitted = { ...base, displayName };
    const parsed = registerRequestSchema.safeParse(submitted);
    if (parsed.success) throw new Error('expected the input to be invalid');
    return toValidationErrors(parsed.error, submitted);
  }

  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
  ])('maps a %s name to displayNameRequired', (_label, value) => {
    expect(errorsFor(value)).toEqual({ fields: { displayName: 'displayNameRequired' } });
  });

  it('maps a missing name to displayNameRequired', () => {
    const parsed = registerRequestSchema.safeParse(base);
    if (parsed.success) throw new Error('expected the input to be invalid');
    expect(toValidationErrors(parsed.error, { ...base, displayName: undefined })).toEqual({
      fields: { displayName: 'displayNameRequired' },
    });
  });

  it.each([
    ['51 characters', 'a'.repeat(51)],
    ['51 emoji', '😀'.repeat(51)],
    ['a NUL character', 'Ana\u0000'],
  ])('maps a name of %s to displayNameTooLong', (_label, value) => {
    expect(errorsFor(value)).toEqual({ fields: { displayName: 'displayNameTooLong' } });
  });
});
