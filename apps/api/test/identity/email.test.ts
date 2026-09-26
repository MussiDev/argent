import { describe, expect, it } from 'vitest';
import { Email } from '../../src/identity/domain/email';
import { InvalidEmail } from '../../src/identity/domain/errors';

describe('Email value object', () => {
  it('trims and lower-cases the address', () => {
    expect(Email.parse('  Ana.Perez+Test@Example.COM ').value).toBe('ana.perez+test@example.com');
  });

  it.each([
    ['no at sign', 'ana.example.com'],
    ['no domain', 'ana@'],
    ['no local part', '@example.com'],
    ['no top-level domain', 'ana@example'],
    ['two at signs', 'ana@b@example.com'],
    ['inner whitespace', 'ana perez@example.com'],
    ['empty', '   '],
    ['domain label starting with a hyphen', 'ana@-example.com'],
  ])('rejects an invalid format (%s) with VALIDATION_FAILED', (_label, raw) => {
    expect(Email.parse('ana@example.com').value).toBe('ana@example.com');
    let caught: unknown;
    try {
      Email.parse(raw);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidEmail);
    expect((caught as InvalidEmail).code).toBe('VALIDATION_FAILED');
  });

  it('accepts 254 characters and rejects 255', () => {
    const longest = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
    expect(longest).toHaveLength(254);
    expect(Email.parse(longest).value).toBe(longest);
    const tooLong = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.com`;
    expect(tooLong).toHaveLength(255);
    expect(() => Email.parse(tooLong)).toThrow(InvalidEmail);
  });

  it('rejects a local part longer than 64 characters', () => {
    expect(Email.parse(`${'a'.repeat(64)}@example.com`).value).toHaveLength(76);
    expect(() => Email.parse(`${'a'.repeat(65)}@example.com`)).toThrow(InvalidEmail);
  });
});
