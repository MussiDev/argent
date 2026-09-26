import { parseOptions } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import {
  ARGON2ID_OPTIONS,
  Argon2idPasswordHasher,
} from '../../src/identity/infrastructure/security/argon2id-password-hasher';

describe('Argon2idPasswordHasher', () => {
  const hasher = new Argon2idPasswordHasher();

  it('uses Argon2id with m=19456, t=2, p=1 and verifies its own hash (NFR-01)', async () => {
    expect(ARGON2ID_OPTIONS).toMatchObject({ memoryCost: 19456, timeCost: 2, parallelism: 1 });

    const hash = await hasher.hash('correct horse battery');

    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(parseOptions(hash)).toMatchObject({ memoryCost: 19456, timeCost: 2, parallelism: 1 });
    expect(hash).not.toContain('correct horse battery');
    await expect(hasher.verify(hash, 'correct horse battery')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hasher.hash('correct horse battery');
    await expect(hasher.verify(hash, 'correct horse batterx')).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const [first, second] = await Promise.all([
      hasher.hash('same password 123'),
      hasher.hash('same password 123'),
    ]);
    expect(first).not.toBe(second);
  });

  it('resolves false instead of throwing for a malformed hash', async () => {
    await expect(hasher.verify('not-a-phc-string', 'whatever123')).resolves.toBe(false);
  });
});
