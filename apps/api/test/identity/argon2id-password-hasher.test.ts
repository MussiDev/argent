import { parseOptions } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/shared/logging/logger';
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

  it('resolves false for a malformed hash and logs a warning without the hash or password', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (line: string) => lines.push(line) },
    });
    const logged = new Argon2idPasswordHasher({ logger });

    await expect(logged.verify('not-a-phc-string', 'whatever123')).resolves.toBe(false);

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(entry.level).toBe(40);
    expect(lines[0]).not.toContain('not-a-phc-string');
    expect(lines[0]).not.toContain('whatever123');
  });

  it('rethrows any error other than a malformed hash', async () => {
    const failure = new Error('native binding crashed');
    const failing = new Argon2idPasswordHasher({ verify: () => Promise.reject(failure) });
    const hash = await hasher.hash('correct horse battery');

    await expect(failing.verify(hash, 'correct horse battery')).rejects.toBe(failure);
  });
});
