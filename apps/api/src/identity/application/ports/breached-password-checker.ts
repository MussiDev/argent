/**
 * Tells whether a password appears in a known breach corpus (NFR-02).
 * Implementations reject with `PasswordCheckUnavailable` when they cannot answer, so callers fail
 * closed (threat R-07).
 */
export interface BreachedPasswordChecker {
  isBreached(password: string): Promise<boolean>;
}
