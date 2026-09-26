import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CryptoTokenGenerator } from '../../src/identity/infrastructure/security/crypto-token-generator';

describe('CryptoTokenGenerator', () => {
  const generator = new CryptoTokenGenerator();

  it('generates 256-bit base64url tokens of 43 characters (NFR-04)', () => {
    const token = generator.generate();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generator.generate()));
    expect(tokens.size).toBe(1000);
  });

  it('hashes with SHA-256 in hex', () => {
    const token = generator.generate();
    expect(generator.hash(token)).toBe(createHash('sha256').update(token).digest('hex'));
    expect(generator.hash(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});
