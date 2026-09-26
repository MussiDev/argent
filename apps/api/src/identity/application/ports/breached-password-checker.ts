import { PasswordBreached } from '../../domain/errors';

/**
 * Tells whether a password appears in a known breach corpus (NFR-02).
 * Implementations reject with `PasswordCheckUnavailable` when they cannot answer, so callers fail
 * closed (threat R-07).
 */
export interface BreachedPasswordChecker {
  isBreached(password: string): Promise<boolean>;
}

/** Rejects with `PasswordBreached` when the checker reports the password as breached. */
export async function assertPasswordNotBreached(
  checker: BreachedPasswordChecker,
  password: string,
): Promise<void> {
  if (await checker.isBreached(password)) throw new PasswordBreached();
}
