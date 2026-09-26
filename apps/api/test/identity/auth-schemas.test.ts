import {
  refreshResponseSchema,
  sessionResponseSchema,
  signInRequestSchema,
  signInResponseSchema,
  PASSWORD_MAX_CODE_POINTS,
  PASSWORD_MAX_UTF16_LENGTH,
  registerRequestSchema,
  registerResponseSchema,
  resendVerificationRequestSchema,
  resendVerificationResponseSchema,
  verifyEmailRequestSchema,
  verifyEmailResponseSchema,
} from '@argent/shared';
import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX_LENGTH } from '../../src/identity/domain/password-rules';

const LOCK_EMOJI = '\u{1F512}';

function passwordAccepted(password: string): boolean {
  return registerRequestSchema.safeParse({ email: 'ana@example.com', password }).success;
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
      timeZone: 'America/Cordoba',
      language: 'es-AR',
      emailVerifiedAt: '2026-01-01',
    });
    expect(parsed).toEqual({
      email: 'ana@example.com',
      password: 'a long enough passphrase',
      timeZone: 'America/Cordoba',
      language: 'es-AR',
    });
    const tooLong = (field: string, length: number) =>
      registerRequestSchema.safeParse({
        email: 'ana@example.com',
        password: 'a long enough passphrase',
        [field]: 'x'.repeat(length),
      }).success;
    expect(tooLong('timeZone', 65)).toBe(false);
    expect(tooLong('language', 36)).toBe(false);
    expect(
      registerRequestSchema.safeParse({
        email: `${'a'.repeat(250)}@x.io`,
        password: 'long enough 1',
      }).success,
    ).toBe(false);
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
    expect(signInResponseSchema.parse({ user: { ...user, passwordHash: 'x' } })).toEqual({ user });
    expect(signInResponseSchema.safeParse({ user: { ...user, language: 'pt' } }).success).toBe(
      false,
    );
    expect(sessionResponseSchema.parse({ user: { ...user, timeZone: 'America/Cordoba' } })).toEqual(
      { user: { ...user, timeZone: 'America/Cordoba' } },
    );
    expect(refreshResponseSchema.parse({ status: 'refreshed' })).toEqual({ status: 'refreshed' });
  });
});
