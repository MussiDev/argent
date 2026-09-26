import { PasswordBreached } from '../domain/errors';
import { passwordLengthRule } from '../domain/password-rules';
import type { BreachedPasswordChecker } from './ports/breached-password-checker';

/**
 * NFR-02: the length rule first (cheap, no I/O), then the breach check. Rejects with
 * `PasswordTooShort`, `PasswordTooLong`, `PasswordBreached` or — fail-closed — whatever the
 * checker rejects with (`PasswordCheckUnavailable`).
 */
export async function assertPasswordAcceptable(
  password: string,
  checker: BreachedPasswordChecker,
): Promise<void> {
  passwordLengthRule(password);
  if (await checker.isBreached(password)) throw new PasswordBreached();
}
