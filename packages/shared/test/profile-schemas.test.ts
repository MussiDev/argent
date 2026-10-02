import { describe, expect, it } from 'vitest';
import {
  DISPLAY_NAME_MAX_CODE_POINTS,
  displayNameSchema,
  profileResponseSchema,
  updateProfileRequestSchema,
} from '../src/profile/profile';

describe('displayNameSchema', () => {
  it('accepts 1 and 50 character names and trims them (AC-02)', () => {
    expect(displayNameSchema.parse('A')).toBe('A');
    expect(displayNameSchema.parse('a'.repeat(50))).toBe('a'.repeat(50));
    expect(displayNameSchema.parse('  Joaquín  ')).toBe('Joaquín');
    expect(DISPLAY_NAME_MAX_CODE_POINTS).toBe(50);
  });

  it('rejects empty, whitespace-only and 51-character names (AC-03)', () => {
    expect(displayNameSchema.safeParse('').success).toBe(false);
    expect(displayNameSchema.safeParse('   ').success).toBe(false);
    expect(displayNameSchema.safeParse('a'.repeat(51)).success).toBe(false);
  });

  it('counts code points: 50 emoji pass and 51 fail (AC-02, AC-03)', () => {
    const fifty = '😀'.repeat(50);
    expect(fifty.length).toBe(100);
    expect(displayNameSchema.safeParse(fifty).success).toBe(true);
    expect(displayNameSchema.safeParse('😀'.repeat(51)).success).toBe(false);
  });

  it('rejects a name containing a NUL character (AC-02)', () => {
    expect(displayNameSchema.safeParse('Ana\u0000').success).toBe(false);
    expect(displayNameSchema.safeParse('A\u0000na').success).toBe(false);
    expect(displayNameSchema.safeParse('A\u0000').success).toBe(false);
  });

  it('rejects an oversized string by its UTF-16 length', () => {
    expect(displayNameSchema.safeParse('a'.repeat(5000)).success).toBe(false);
  });
});

describe('updateProfileRequestSchema', () => {
  it('accepts an email field and strips unknown keys (FR-03)', () => {
    const parsed = updateProfileRequestSchema.parse({
      displayName: 'Ana',
      email: 'ana@example.com',
      userId: 'x',
      passwordHash: 'y',
    });
    expect(parsed).toEqual({ displayName: 'Ana', email: 'ana@example.com' });
  });

  it('canonicalizes the time zone', () => {
    expect(updateProfileRequestSchema.parse({ timeZone: 'europe/madrid' }).timeZone).toBe(
      'Europe/Madrid',
    );
  });

  it('accepts each changeable field on its own', () => {
    expect(updateProfileRequestSchema.safeParse({ defaultRateType: 'blue' }).success).toBe(true);
    expect(updateProfileRequestSchema.safeParse({ displayCurrency: 'USD' }).success).toBe(true);
    expect(updateProfileRequestSchema.safeParse({ language: 'en' }).success).toBe(true);
  });

  it('rejects an update with no changeable field (FR-02)', () => {
    expect(updateProfileRequestSchema.safeParse({}).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse({ email: 'ana@example.com' }).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse({ userId: 'x' }).success).toBe(false);
  });

  it('rejects a rate type, display currency or language outside its list (FR-04, FR-05, FR-07)', () => {
    expect(updateProfileRequestSchema.safeParse({ defaultRateType: 'nope' }).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse({ displayCurrency: 'EUR' }).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse({ language: 'fr' }).success).toBe(false);
  });

  it('rejects an invalid time zone', () => {
    expect(updateProfileRequestSchema.safeParse({ timeZone: 'Mars/Olympus' }).success).toBe(false);
  });
});

describe('profileResponseSchema', () => {
  const base = {
    displayName: null,
    email: 'ana@example.com',
    twoFactorEnabled: false,
    deletionReauth: 'password',
    preferences: {
      defaultRateType: 'mep',
      displayCurrency: 'ARS',
      timeZone: 'America/Argentina/Buenos_Aires',
      language: 'es',
    },
  };

  it('accepts a null display name', () => {
    expect(profileResponseSchema.safeParse(base).success).toBe(true);
  });

  it('carries deletionReauth as password or google and rejects any other value (FR-01)', () => {
    expect(profileResponseSchema.parse(base).deletionReauth).toBe('password');
    expect(profileResponseSchema.parse({ ...base, deletionReauth: 'google' }).deletionReauth).toBe(
      'google',
    );
    expect(profileResponseSchema.safeParse({ ...base, deletionReauth: 'email' }).success).toBe(
      false,
    );
    expect(profileResponseSchema.safeParse({ ...base, deletionReauth: undefined }).success).toBe(
      false,
    );
  });

  it('accepts a stored time zone the strict request check would refuse', () => {
    const value = { ...base, preferences: { ...base.preferences, timeZone: '+01:00' } };
    expect(profileResponseSchema.safeParse(value).success).toBe(true);
  });
});
