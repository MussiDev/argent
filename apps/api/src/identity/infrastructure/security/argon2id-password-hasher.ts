import { hash, verify, type Algorithm } from '@node-rs/argon2';
import type { Logger } from '../../../shared/logging/logger';
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

/**
 * A valid Argon2id hash (same parameters as real ones) of a random password nobody knows. Verified
 * when an email is not registered, so that path costs the same as a real verification (NFR-08).
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$VqVzkp2juZp90ahHXnyGHA$kir7DPmzYxgrr7ICycIzOYK9qa4LL04hDKG9no2FaOY';

/** What @node-rs/argon2 reports when the stored hash cannot be decoded. */
const MALFORMED_HASH_CODE = 'InvalidArg';

function isMalformedHashError(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === MALFORMED_HASH_CODE;
}

export interface Argon2idPasswordHasherOptions {
  logger?: Logger;
  /** Injected in tests to simulate failures of the native binding. */
  verify?: typeof verify;
}

export class Argon2idPasswordHasher implements PasswordHasher {
  private readonly logger: Logger | undefined;
  private readonly verifyFn: typeof verify;

  constructor(options: Argon2idPasswordHasherOptions = {}) {
    this.logger = options.logger;
    this.verifyFn = options.verify ?? verify;
  }

  hash(password: string): Promise<string> {
    return hash(password, ARGON2ID_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await this.verifyFn(passwordHash, password);
    } catch (error) {
      // A malformed stored hash can only mean "does not match"; it must not become a 500 that
      // tells an attacker something differs about this account. Anything else is a real failure.
      if (!isMalformedHashError(error)) throw error;
      this.logger?.warn('stored password hash is malformed; treated as a mismatch');
      return false;
    }
  }
}
