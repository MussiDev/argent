import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SecretBoxUnavailable,
  type SecretBox,
} from '../../src/identity/application/ports/secret-box';
import {
  AesGcmSecretBox,
  UnavailableSecretBox,
} from '../../src/identity/infrastructure/security/aes-gcm-secret-box';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const USER = '6f1c1d6e-0000-4000-8000-000000000001';
const OTHER_USER = '6f1c1d6e-0000-4000-8000-000000000002';
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/** Flips one bit of the base64url segment at `index` of a sealed value. */
function tamper(sealed: string, index: number): string {
  const parts = sealed.split('.');
  const bytes = Buffer.from(parts[index] ?? '', 'base64url');
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  parts[index] = bytes.toString('base64url');
  return parts.join('.');
}

describe('AesGcmSecretBox', () => {
  const box = new AesGcmSecretBox(KEY);

  it('round-trips a secret sealed for a user id', () => {
    const sealed = box.seal(SECRET, USER);

    expect(sealed).not.toContain(SECRET);
    expect(box.open(sealed, USER)).toBe(SECRET);
  });

  it('uses the format v1.<keyId>.<iv>.<ciphertext>.<tag> with a random 96-bit IV per seal', () => {
    const keyId = createHash('sha256').update(Buffer.from(KEY, 'base64')).digest('hex').slice(0, 8);
    const first = box.seal(SECRET, USER);
    const second = box.seal(SECRET, USER);

    expect(first).not.toBe(second);
    const [version, id, iv, ciphertext, tag, ...rest] = first.split('.');
    expect(rest).toEqual([]);
    expect(version).toBe('v1');
    expect(id).toBe(keyId);
    expect(Buffer.from(iv ?? '', 'base64url')).toHaveLength(12);
    expect(Buffer.from(ciphertext ?? '', 'base64url')).toHaveLength(SECRET.length);
    expect(Buffer.from(tag ?? '', 'base64url')).toHaveLength(16);
    for (const part of [iv, ciphertext, tag]) expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['the IV', 2],
    ['the ciphertext', 3],
    ['the tag', 4],
  ])('refuses to open a value with %s tampered (sad path)', (_part, index) => {
    const sealed = box.seal(SECRET, USER);

    expect(() => box.open(tamper(sealed, index), USER)).toThrow();
  });

  it('refuses to open a value sealed under another key (sad path)', () => {
    const sealed = new AesGcmSecretBox(OTHER_KEY).seal(SECRET, USER);

    expect(() => box.open(sealed, USER)).toThrow();
  });

  it("refuses to open a value sealed for another user id, so it cannot be moved to another user's row (sad path)", () => {
    const sealed = box.seal(SECRET, OTHER_USER);

    expect(() => box.open(sealed, USER)).toThrow();
  });

  it.each([
    ['an empty value', ''],
    ['another version', 'v2.a.b.c.d'],
    ['a missing part', 'v1.a.b.c'],
  ])('refuses to open %s (sad path)', (_label, sealed) => {
    expect(() => box.open(sealed, USER)).toThrow();
  });

  it('refuses a truncated tag, even when a prefix of the real one (sad path)', () => {
    const parts = box.seal(SECRET, USER).split('.');
    parts[4] = Buffer.from(parts[4] ?? '', 'base64url')
      .subarray(0, 4)
      .toString('base64url');

    expect(() => box.open(parts.join('.'), USER)).toThrow();
  });

  it.each([
    ['16 bytes', randomBytes(16).toString('base64')],
    ['33 bytes', randomBytes(33).toString('base64')],
    ['not base64', '!'.repeat(44)],
  ])('refuses a key of %s (sad path)', (_label, key) => {
    expect(() => new AesGcmSecretBox(key)).toThrow();
  });
});

describe('UnavailableSecretBox', () => {
  it('throws SecretBoxUnavailable on seal and open (sad path)', () => {
    const box: SecretBox = new UnavailableSecretBox();

    expect(() => box.seal(SECRET, USER)).toThrow(SecretBoxUnavailable);
    expect(() => box.open('v1.a.b.c.d', USER)).toThrow(SecretBoxUnavailable);
  });
});
