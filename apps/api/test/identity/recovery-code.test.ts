import { describe, expect, it } from 'vitest';
import {
  formatRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from '../../src/identity/domain/recovery-code';
import { CryptoRecoveryCodeGenerator } from '../../src/identity/infrastructure/security/crypto-recovery-code-generator';

const DISPLAY_FORM = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;

describe('CryptoRecoveryCodeGenerator', () => {
  const generator = new CryptoRecoveryCodeGenerator();

  it('generates 10 distinct codes of 10 Crockford base32 characters shown as xxxxx-xxxxx (FR-03)', () => {
    const codes = generator.generate(RECOVERY_CODE_COUNT);

    expect(RECOVERY_CODE_COUNT).toBe(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(DISPLAY_FORM);
      expect(normalizeRecoveryCode(code)).toBe(code.replace('-', ''));
    }
  });

  it('draws 50 random bits per code: every character position varies', () => {
    const codes = generator.generate(400).map((code) => code.replace('-', ''));

    expect(new Set(codes).size).toBe(400);
    for (let position = 0; position < 10; position += 1) {
      const seen = new Set(codes.map((code) => code[position]));
      expect(seen.size).toBeGreaterThan(16);
    }
  });
});

describe('recovery code normalization (FR-03)', () => {
  it('formats a stored code as xxxxx-xxxxx', () => {
    expect(formatRecoveryCode('ABCDE12345')).toBe('ABCDE-12345');
  });

  it.each([
    ['ABCDE-12345', 'ABCDE12345'],
    ['abcde-12345', 'ABCDE12345'],
    ['  abcde 12345 ', 'ABCDE12345'],
    ['ab cd e-1 2 3-45', 'ABCDE12345'],
    ['I1LlO0oi-ZZ', '11110001ZZ'],
    ['xyz0o-illab', 'XYZ00111AB'],
  ])('normalizes %j to %j', (input, stored) => {
    expect(normalizeRecoveryCode(input)).toBe(stored);
  });

  it.each([
    ['too short', 'ABCDE-1234'],
    ['too long', 'ABCDE-123456'],
    ['U is not in the alphabet', 'ABCDE-1234U'],
    ['a symbol', 'ABCDE-1234!'],
    ['empty', ''],
    ['a non-ASCII digit', 'ABCDE-1234５'],
  ])('refuses a code that is %s (sad path)', (_label, input) => {
    expect(normalizeRecoveryCode('ABCDE-12345')).toBe('ABCDE12345');
    expect(normalizeRecoveryCode(input)).toBeNull();
  });
});
