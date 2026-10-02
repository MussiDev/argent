import {
  passwordResetConfirmRequestSchema,
  passwordResetConfirmResponseSchema,
  passwordResetRequestSchema,
  passwordResetResponseSchema,
  refreshResponseSchema,
  sessionResponseSchema,
  signInRequestSchema,
  SIGN_IN_ERRORS,
  signInResponseSchema,
  PASSWORD_MAX_CODE_POINTS,
  PASSWORD_MAX_UTF16_LENGTH,
  registerRequestSchema,
  registerResponseSchema,
  resendVerificationRequestSchema,
  resendVerificationResponseSchema,
  verifyEmailRequestSchema,
  verifyEmailResponseSchema,
} from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX_LENGTH } from '../../src/identity/domain/password-rules';

const LOCK_EMOJI = '\u{1F512}';

function passwordAccepted(password: string): boolean {
  return registerRequestSchema.safeParse({ email: 'ana@example.com', password, displayName: 'Ana' })
    .success;
}

describe('shared auth schemas', () => {
  it('counts the password maximum in code points, like the domain rule', () => {
    expect(PASSWORD_MAX_CODE_POINTS).toBe(PASSWORD_MAX_LENGTH);
    expect(passwordAccepted(LOCK_EMOJI.repeat(128))).toBe(true);
    expect(passwordAccepted(LOCK_EMOJI.repeat(129))).toBe(false);
    expect(passwordAccepted('x'.repeat(128))).toBe(true);
    expect(passwordAccepted('x'.repeat(129))).toBe(false);
  });

  it('caps the raw UTF-16 length before counting code points (DoS guard)', () => {
    expect(PASSWORD_MAX_UTF16_LENGTH).toBe(512);
    const result = registerRequestSchema.safeParse({
      email: 'ana@example.com',
      password: 'x'.repeat(PASSWORD_MAX_UTF16_LENGTH + 1),
      displayName: 'Ana',
    });
    expect(result.success).toBe(false);
  });

  it('leaves the minimum length to the domain rule, so short passwords get PASSWORD_TOO_SHORT', () => {
    expect(passwordAccepted('123456789')).toBe(true);
    expect(passwordAccepted('')).toBe(false);
  });

  it('bounds email, time zone and language and strips unknown keys', () => {
    const parsed = registerRequestSchema.parse({
      email: ' ana@example.com ',
      password: 'a long enough passphrase',
      displayName: ' Ana ',
      timeZone: 'America/Cordoba',
      language: 'es-AR',
      emailVerifiedAt: '2026-01-01',
    });
    expect(parsed).toEqual({
      email: 'ana@example.com',
      password: 'a long enough passphrase',
      displayName: 'Ana',
      timeZone: 'America/Cordoba',
      language: 'es-AR',
    });
    const tooLong = (field: string, length: number) =>
      registerRequestSchema.safeParse({
        email: 'ana@example.com',
        password: 'a long enough passphrase',
        displayName: 'Ana',
        [field]: 'x'.repeat(length),
      }).success;
    expect(tooLong('timeZone', 65)).toBe(false);
    expect(tooLong('language', 36)).toBe(false);
    expect(
      registerRequestSchema.safeParse({
        email: `${'a'.repeat(250)}@x.io`,
        password: 'long enough 1',
        displayName: 'Ana',
      }).success,
    ).toBe(false);
  });

  describe('registration display name', () => {
    const accepts = (displayName: unknown) =>
      registerRequestSchema.safeParse({
        email: 'ana@example.com',
        password: 'a long enough passphrase',
        displayName,
      }).success;

    it('accepts 1 and 50 characters and trims the value', () => {
      expect(accepts('A')).toBe(true);
      expect(accepts('a'.repeat(50))).toBe(true);
      const parsed = registerRequestSchema.parse({
        email: 'ana@example.com',
        password: 'a long enough passphrase',
        displayName: '  Ana  ',
      });
      expect(parsed.displayName).toBe('Ana');
    });

    it('reports a missing display name as invalid', () => {
      const result = registerRequestSchema.safeParse({
        email: 'ana@example.com',
        password: 'a long enough passphrase',
      });
      expect(result.success).toBe(false);
      expect(!result.success && result.error.issues[0]?.path).toEqual(['displayName']);
    });

    it('reports an empty and a whitespace-only display name as invalid', () => {
      expect(accepts('')).toBe(false);
      expect(accepts('   ')).toBe(false);
    });

    it('reports 51 characters and a NUL character as invalid; 50 emoji pass', () => {
      expect(accepts('a'.repeat(51))).toBe(false);
      expect(accepts('Ana\u0000')).toBe(false);
      expect(accepts('A\u0000na')).toBe(false);
      expect(accepts(LOCK_EMOJI.repeat(50))).toBe(true);
      expect(accepts(LOCK_EMOJI.repeat(51))).toBe(false);
    });
  });

  it('accepts only 43-character base64url tokens', () => {
    const accepts = (token: string) => verifyEmailRequestSchema.safeParse({ token }).success;
    expect(accepts('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO-_')).toBe(true);
    expect(accepts('A'.repeat(42))).toBe(false);
    expect(accepts('A'.repeat(44))).toBe(false);
    expect(accepts(`${'A'.repeat(42)}=`)).toBe(false);
    expect(accepts(`${'A'.repeat(42)}/`)).toBe(false);
  });

  it('describes the response bodies', () => {
    expect(registerResponseSchema.parse({ status: 'verification_sent' })).toEqual({
      status: 'verification_sent',
    });
    expect(verifyEmailResponseSchema.parse({ status: 'verified' })).toEqual({ status: 'verified' });
    expect(resendVerificationResponseSchema.parse({ status: 'verification_sent' })).toEqual({
      status: 'verification_sent',
    });
    expect(resendVerificationRequestSchema.parse({ anything: 1 })).toEqual({});
    expect(registerResponseSchema.safeParse({ status: 'created' }).success).toBe(false);
  });

  it('describes sign-in and session bodies; sign-in accepts any 1-128 character password', () => {
    const accepts = (password: string) =>
      signInRequestSchema.safeParse({ email: 'ana@example.com', password }).success;
    expect(accepts('x')).toBe(true);
    expect(accepts('x'.repeat(128))).toBe(true);
    expect(accepts('')).toBe(false);
    expect(accepts('x'.repeat(129))).toBe(false);
    expect(
      signInRequestSchema.parse({ email: ' ana@example.com ', password: 'p', extra: true }),
    ).toEqual({ email: 'ana@example.com', password: 'p' });

    const user = { id: 'u1', email: 'ana@example.com', emailVerified: false, language: 'en' };
    expect(
      signInResponseSchema.parse({ status: 'signed_in', user: { ...user, passwordHash: 'x' } }),
    ).toEqual({ status: 'signed_in', user });
    expect(
      signInResponseSchema.safeParse({ status: 'signed_in', user: { ...user, language: 'pt' } })
        .success,
    ).toBe(false);
    // A first factor that needs the second one says nothing about the user (threat R-48).
    expect(signInResponseSchema.parse({ status: 'second_factor_required', user })).toEqual({
      status: 'second_factor_required',
    });
    expect(signInResponseSchema.safeParse({ user }).success).toBe(false);
    expect(signInResponseSchema.safeParse({ status: 'signed_in' }).success).toBe(false);
    expect(SIGN_IN_ERRORS).toEqual(['google_failed', 'second_factor_expired']);
    expect(sessionResponseSchema.parse({ user: { ...user, timeZone: 'America/Cordoba' } })).toEqual(
      { user: { ...user, timeZone: 'America/Cordoba' } },
    );
    expect(refreshResponseSchema.parse({ status: 'refreshed' })).toEqual({ status: 'refreshed' });
  });

  it('describes the password reset bodies; the token travels only in the body', () => {
    expect(passwordResetRequestSchema.parse({ email: ' ana@example.com ', extra: 1 })).toEqual({
      email: 'ana@example.com',
    });
    expect(passwordResetRequestSchema.safeParse({ email: 'x'.repeat(255) }).success).toBe(false);
    expect(passwordResetRequestSchema.safeParse({}).success).toBe(false);

    const token = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO-_';
    const confirmAccepts = (body: Record<string, unknown>) =>
      passwordResetConfirmRequestSchema.safeParse(body).success;
    expect(confirmAccepts({ token, newPassword: 'x' })).toBe(true);
    expect(confirmAccepts({ token, newPassword: 'x'.repeat(128) })).toBe(true);
    expect(confirmAccepts({ token, newPassword: LOCK_EMOJI.repeat(129) })).toBe(false);
    expect(confirmAccepts({ token, newPassword: '' })).toBe(false);
    expect(confirmAccepts({ token: 'A'.repeat(42), newPassword: 'a long passphrase' })).toBe(false);
    expect(confirmAccepts({ token: `${'A'.repeat(42)}=`, newPassword: 'a long passphrase' })).toBe(
      false,
    );

    expect(passwordResetResponseSchema.parse({ status: 'reset_sent_if_registered' })).toEqual({
      status: 'reset_sent_if_registered',
    });
    expect(passwordResetConfirmResponseSchema.parse({ status: 'password_updated' })).toEqual({
      status: 'password_updated',
    });
    expect(passwordResetResponseSchema.safeParse({ status: 'sent' }).success).toBe(false);
  });
});
