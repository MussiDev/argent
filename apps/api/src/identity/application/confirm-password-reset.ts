import { PasswordBreached, TokenInvalid } from '../domain/errors';
import { passwordLengthRule } from '../domain/password-rules';
import type { BreachedPasswordChecker } from './ports/breached-password-checker';
import type { Clock } from './ports/clock';
import type { PasswordHasher } from './ports/password-hasher';
import type { TokenGenerator } from './ports/token-generator';
import type { UnitOfWork } from './ports/unit-of-work';

export interface ConfirmPasswordResetDependencies {
  tokenGenerator: TokenGenerator;
  clock: Clock;
  breachedPasswordChecker: BreachedPasswordChecker;
  passwordHasher: PasswordHasher;
  unitOfWork: UnitOfWork;
}

export interface ConfirmPasswordResetInput {
  token: string;
  newPassword: string;
}

export class ConfirmPasswordReset {
  constructor(private readonly deps: ConfirmPasswordResetDependencies) {}

  /**
   * Consumes the unused, unexpired reset token, sets the new password (bumping the user's
   * credentials version), revokes every session of the user and removes its non-authoritative
   * Google identities, atomically (AC-10). Rejects with
   * `TokenInvalid` for an unknown, expired or used token (AC-11), and with the password policy's
   * errors for a short, breached or uncheckable password; in every rejection nothing changes and
   * the token stays usable.
   */
  async execute({ token, newPassword }: ConfirmPasswordResetInput): Promise<{ userId: string }> {
    // Pure and cheap: no transaction is opened for a password that can never be accepted.
    passwordLengthRule(newPassword);
    const tokenHash = this.deps.tokenGenerator.hash(token);
    const now = this.deps.clock.now();
    return this.deps.unitOfWork.run(async ({ oneTimeTokens, users, sessions, identities }) => {
      // Consumed first: the row stays locked until commit, so a concurrent confirm with the same
      // token waits and then finds it used. Any later rejection rolls the consumption back.
      const consumed = await oneTimeTokens.consume(tokenHash, 'password_reset', now);
      if (!consumed) throw new TokenInvalid();
      // Fail-closed: `PasswordCheckUnavailable` propagates and rolls everything back (R-07).
      if (await this.deps.breachedPasswordChecker.isBreached(newPassword)) {
        throw new PasswordBreached();
      }
      const passwordHash = await this.deps.passwordHasher.hash(newPassword);
      await users.changePassword(consumed.userId, passwordHash, now);
      // Evicts every committed session. One committed concurrently with this transaction escapes
      // the revocation but carries the old credentials version, so it is rejected on use.
      await sessions.revokeAllForUser(consumed.userId, now);
      // Control of the mailbox outranks a Google account that is not authoritative for the email,
      // so whoever holds such a link loses it (PRD 01b FR-07, threat R-37).
      await identities.deleteNonAuthoritativeForUser(consumed.userId);
      return { userId: consumed.userId };
    });
  }
}
