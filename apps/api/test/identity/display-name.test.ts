import { describe, expect, it } from 'vitest';
import { displayNameFromGoogleClaim } from '../../src/identity/domain/display-name';

const EMOJI = '\u{1F600}';

describe('displayNameFromGoogleClaim', () => {
  it('returns the trimmed name for 1 to 50 code points', () => {
    expect(displayNameFromGoogleClaim('A')).toBe('A');
    expect(displayNameFromGoogleClaim('  Ana Pérez  ')).toBe('Ana Pérez');
    expect(displayNameFromGoogleClaim('a'.repeat(50))).toBe('a'.repeat(50));
    expect(displayNameFromGoogleClaim(EMOJI.repeat(50))).toBe(EMOJI.repeat(50));
  });

  it('returns null for null, empty, spaces only and NUL only', () => {
    expect(displayNameFromGoogleClaim(null)).toBeNull();
    expect(displayNameFromGoogleClaim('')).toBeNull();
    expect(displayNameFromGoogleClaim('   ')).toBeNull();
    expect(displayNameFromGoogleClaim('\u0000\u0000')).toBeNull();
    expect(displayNameFromGoogleClaim(' \u0000 ')).toBeNull();
  });

  it('keeps the first 50 code points of a longer name without splitting an emoji', () => {
    const result = displayNameFromGoogleClaim(EMOJI.repeat(60));
    expect(result).toBe(EMOJI.repeat(50));
    expect(Array.from(result ?? '')).toHaveLength(50);
  });

  it('leaves no trailing space after the cut and removes a NUL inside the name', () => {
    const cut = displayNameFromGoogleClaim(`${'a'.repeat(49)} ${'b'.repeat(10)}`);
    expect(cut).toBe('a'.repeat(49));
    expect(displayNameFromGoogleClaim('Ana\u0000 Pérez')).toBe('Ana Pérez');
  });
});
