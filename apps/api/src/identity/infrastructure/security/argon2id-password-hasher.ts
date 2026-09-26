import { hash, verify, type Algorithm } from '@node-rs/argon2';
import type { PasswordHasher } from '../../application/ports/password-hasher';

// `Algorithm` is an ambient const enum, which isolatedModules cannot read at runtime.
const ARGON2ID = 2 as Algorithm;

/** OWASP's Argon2id baseline: 19 MiB of memory, 2 passes, 1 lane (NFR-01). */
export const ARGON2ID_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export class Argon2idPasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password, ARGON2ID_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      // A malformed stored hash can only mean "does not match"; it must not become a 500 that
      // tells an attacker something differs about this account.
      return false;
    }
  }
}
