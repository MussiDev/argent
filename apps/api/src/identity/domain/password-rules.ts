import { PasswordTooLong, PasswordTooShort } from './errors';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Length policy of NFR-02, counted in Unicode code points as NIST SP 800-63B asks (an emoji is one
 * character, not two UTF-16 units). Throws `PasswordTooShort` (< 10) or `PasswordTooLong` (> 128).
 */
export function passwordLengthRule(password: string): void {
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH) throw new PasswordTooShort();
  if (length > PASSWORD_MAX_LENGTH) throw new PasswordTooLong();
}
