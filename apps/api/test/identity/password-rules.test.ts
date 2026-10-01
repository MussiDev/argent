import type { AppError } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { PasswordTooLong, PasswordTooShort } from '../../src/identity/domain/errors';
import { passwordLengthRule } from '../../src/identity/domain/password-rules';

describe('password length rule', () => {
  it('rejects a password of 9 characters with PASSWORD_TOO_SHORT (NFR-02)', () => {
    let caught: unknown;
    try {
      passwordLengthRule('a'.repeat(9));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PasswordTooShort);
    expect((caught as AppError).code).toBe('PASSWORD_TOO_SHORT');
  });

  it('accepts 10 and 128 characters', () => {
    expect(() => {
      passwordLengthRule('a'.repeat(9));
    }).toThrow(PasswordTooShort);
    expect(() => {
      passwordLengthRule('a'.repeat(10));
    }).not.toThrow();
    expect(() => {
      passwordLengthRule('a'.repeat(128));
    }).not.toThrow();
  });

  it('rejects 129 characters with VALIDATION_FAILED', () => {
    expect(() => {
      passwordLengthRule('a'.repeat(129));
    }).toThrow(PasswordTooLong);
  });

  it('counts characters, not UTF-16 code units', () => {
    // 9 emoji are 18 code units but 9 characters.
    expect(() => {
      passwordLengthRule('😀'.repeat(9));
    }).toThrow(PasswordTooShort);
  });
});
