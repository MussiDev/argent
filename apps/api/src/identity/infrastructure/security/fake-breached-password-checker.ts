import type { BreachedPasswordChecker } from '../../application/ports/breached-password-checker';

/** Passwords the fake treats as breached; tests and e2e use them to exercise `PASSWORD_BREACHED`. */
export const FAKE_BREACHED_PASSWORDS: readonly string[] = [
  'password123',
  '1234567890',
  'qwertyuiop',
  'iloveyou123',
  'contraseña123',
];

/** Deterministic, offline stand-in for HIBP (`BREACH_CHECKER=fake`); never used in production. */
export class FakeBreachedPasswordChecker implements BreachedPasswordChecker {
  private readonly breached: ReadonlySet<string>;

  constructor(breached: readonly string[] = FAKE_BREACHED_PASSWORDS) {
    this.breached = new Set(breached);
  }

  isBreached(password: string): Promise<boolean> {
    return Promise.resolve(this.breached.has(password));
  }
}
