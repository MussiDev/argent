import { RateLimited, TotpInvalid, TwoFactorNotEnabled, Unauthenticated } from '../domain/errors';
import { TWO_FACTOR_DISABLE_POLICIES } from './attempt-policies';
import type { AttemptLimiter } from './ports/attempt-limiter';
import type { Clock } from './ports/clock';
import type { PasswordHasher } from './ports/password-hasher';
import type { RecoveryCodeRepository } from './ports/recovery-code-repository';
import type { SecretBox } from './ports/secret-box';
import type { TotpEngine } from './ports/totp';
import type { TwoFactorRepository } from './ports/two-factor-repository';
import type { UnitOfWork } from './ports/unit-of-work';
import type { User, UserRepository } from './ports/user-repository';
import {
  checkSecondFactorCode,
  parseSecondFactorCode,
  recordSignInFailure,
  refundAttempt,
  reserveAttempt,
} from './second-factor-limits';
import type { SessionTokens, StartSession } from './start-session';

export interface DisableTwoFactorDependencies {
  users: UserRepository;
  twoFactor: TwoFactorRepository;
  recoveryCodes: RecoveryCodeRepository;
  totp: TotpEngine;
  secretBox: SecretBox;
  /** Argon2id, to check recovery codes against their hashes. */
  passwordHasher: PasswordHasher;
  attemptLimiter: AttemptLimiter;
  unitOfWork: UnitOfWork;
  startSession: StartSession;
  clock: Clock;
  /** Told when a refund fails; the outcome (204 or 429) is unchanged (fail safe). */
  reportRefundFailure: (error: unknown) => void;
  /** Told when the NFR-01 unit of a wrong code could not be recorded; the 400 is unchanged. */
  reportRecordFailure: (error: unknown) => void;
  /** Told when the caller's new session could not be started after 2FA was turned off. */
  reportReissueFailure: (error: unknown) => void;
}

export interface DisableTwoFactorInput {
  userId: string;
  /** A TOTP code or a recovery code, as typed. */
  code: string;
}

export interface DisableTwoFactorResult {
  /** The caller's new session, or null when it could not be started (the user signs in again). */
  session: SessionTokens | null;
}

/**
 * Turns 2FA off with a valid TOTP code or an unused recovery code (FR-02, AC-03): deletes the
 * secret, the recovery codes and pending sign-in challenges, ends every session of the user, emails
 * a notice (FR-05, AC-07) and starts a new session for the caller.
 */
export class DisableTwoFactor {
  constructor(private readonly deps: DisableTwoFactorDependencies) {}

  async execute({ userId, code }: DisableTwoFactorInput): Promise<DisableTwoFactorResult> {
    const settings = await this.deps.twoFactor.findByUserId(userId);
    if (!settings?.enabledAt) throw new TwoFactorNotEnabled();
    const user = await this.deps.users.findById(userId);
    if (!user) throw new Unauthenticated();

    const limiter = this.deps.attemptLimiter;
    const attempt = await reserveAttempt(limiter, TWO_FACTOR_DISABLE_POLICIES, userId);
    if (!attempt.allowed) {
      // Refused without checking: not a guess, so it does not count either.
      await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
      throw new RateLimited();
    }

    const now = this.deps.clock.now();
    const parsed = parseSecondFactorCode(code);
    let valid: boolean;
    try {
      valid =
        parsed !== null &&
        (await checkSecondFactorCode(this.deps, this.deps, settings, parsed, now));
    } catch (error) {
      // Not a guess either (no encryption key, a fault): the units go back and the error stands.
      await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
      throw error;
    }
    if (!valid) {
      // A concurrent disable may have removed the secret or the codes the check looked for: that
      // is not a guess, so it gives its units back.
      if (!(await this.deps.twoFactor.findByUserId(userId))?.enabledAt) {
        await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
        throw new TwoFactorNotEnabled();
      }
      // A wrong code keeps its units, and also counts toward the sign-in limit (NFR-01).
      await recordSignInFailure(limiter, user.email, this.deps.reportRecordFailure);
      throw new TotpInvalid();
    }

    let credentialsVersion: number;
    try {
      credentialsVersion = await this.disableInTransaction(userId, user, now);
    } catch (error) {
      // Already disabled by a concurrent request (409) or a fault (500): not a failed guess.
      await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
      throw error;
    }
    // Only failed guesses keep their units.
    await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);

    let session: SessionTokens | null = null;
    try {
      session = await this.deps.startSession.execute({ id: userId, credentialsVersion });
    } catch (error) {
      this.deps.reportReissueFailure(error);
    }
    return { session };
  }

  /** Resolves the new credentials version; rejects with `TwoFactorNotEnabled` if already off. */
  private disableInTransaction(userId: string, user: User, now: Date): Promise<number> {
    return this.deps.unitOfWork.run(
      async ({ twoFactor, recoveryCodes, signInChallenges, users, sessions, emailSender }) => {
        // Of two concurrent disables only one deletes the row; the other rolls back here, so
        // there is one bump and one notice.
        if (!(await twoFactor.delete(userId))) throw new TwoFactorNotEnabled();
        await recoveryCodes.deleteAll(userId);
        await signInChallenges.deleteForUser(userId);
        // Every session created under the old version dies on its next use (AC-07, R-46).
        const version = await users.bumpCredentialsVersion(userId);
        await sessions.revokeAllForUser(userId, now);
        await emailSender.enqueue({
          kind: 'two_factor_disabled',
          userId,
          toEmail: user.email,
          language: user.language,
        });
        return version;
      },
    );
  }
}
