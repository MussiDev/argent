import { Email } from '../domain/email';
import {
  InvalidCredentials,
  RateLimited,
  ReauthenticationRequired,
  TotpInvalid,
  Unauthenticated,
} from '../domain/errors';
import {
  SIGN_IN_ACCOUNT_POLICY,
  SIGN_IN_IP_POLICY,
  TWO_FACTOR_DISABLE_POLICIES,
} from './attempt-policies';
import { UNKNOWN_IP } from './client-ip';
import type { AttemptLimiter } from './ports/attempt-limiter';
import type { Clock } from './ports/clock';
import type { PasswordHasher } from './ports/password-hasher';
import type { RecoveryCodeRepository } from './ports/recovery-code-repository';
import type { SecretBox } from './ports/secret-box';
import type { TotpEngine } from './ports/totp';
import type { TwoFactorRepository, TwoFactorSettings } from './ports/two-factor-repository';
import type { UserDeletionRepository } from './ports/user-deletion-repository';
import type { User, UserRepository } from './ports/user-repository';
import {
  checkSecondFactorCode,
  parseSecondFactorCode,
  recordSignInFailure,
  refundAttempt,
  reserveAttempt,
  type ReservedAttempt,
} from './second-factor-limits';

/** The deletion grant lives 5 minutes (NFR-03). */
export const DELETION_GRANT_TTL_MS = 5 * 60 * 1000;

export interface DeleteUserDependencies {
  users: UserRepository;
  twoFactor: TwoFactorRepository;
  recoveryCodes: RecoveryCodeRepository;
  totp: TotpEngine;
  secretBox: SecretBox;
  /** Argon2id, for the password and for the hashes of recovery codes. */
  passwordHasher: PasswordHasher;
  attemptLimiter: AttemptLimiter;
  userDeletion: UserDeletionRepository;
  clock: Clock;
  /** Told when a refund fails; the outcome is unchanged (fail safe). Must not log secrets. */
  reportRefundFailure: (error: unknown) => void;
  /** Told when the NFR-01 unit of a wrong code could not be recorded; the 400 is unchanged. */
  reportRecordFailure: (error: unknown) => void;
}

export interface DeleteUserInput {
  userId: string;
  /** The session that asked; Google re-authentication (a later block) binds its grant to it. */
  sessionId: string;
  password: string | undefined;
  secondFactorCode: string | undefined;
  grantToken: string | undefined;
  ip: string | undefined;
}

/**
 * Deletes the account and everything that belongs to it (FR-01) after the user proves who they are
 * again: the password (checked with the sign-in limits, so a wrong one counts as a failed sign-in)
 * and, with 2FA on, a valid second-factor code (limited like disabling 2FA).
 */
export class DeleteUser {
  constructor(private readonly deps: DeleteUserDependencies) {}

  async execute({ userId, password, secondFactorCode, ip }: DeleteUserInput): Promise<void> {
    // The user is read before its 2FA settings: a 2FA enable that commits in between bumped the
    // credentials version, so `erase` below refuses instead of the second factor being skipped.
    const user = await this.deps.users.findById(userId);
    if (!user) throw new Unauthenticated();
    const settings = await this.deps.twoFactor.findByUserId(userId);

    // Accounts without a password re-authenticate through Google (a later block adds that path).
    if (user.passwordHash === null) throw new ReauthenticationRequired();
    await this.checkPassword(user.email, user.passwordHash, password, ip ?? UNKNOWN_IP);
    if (settings?.enabledAt) await this.checkSecondFactor(user, settings, secondFactorCode);

    // A credentials version that moved on since the read (a password reset, a 2FA change) or an
    // account that is already gone is refused here, atomically with the deletion.
    const result = await this.deps.userDeletion.erase({
      userId,
      credentialsVersion: user.credentialsVersion,
    });
    if (result !== 'erased') throw new Unauthenticated();
  }

  /** Reserve-then-refund with the sign-in policies: only failed guesses keep their units. */
  private async checkPassword(
    email: string,
    passwordHash: string,
    password: string | undefined,
    ip: string,
  ): Promise<void> {
    // Not a guess, so nothing is reserved.
    if (password === undefined) throw new InvalidCredentials();

    const limiter = this.deps.attemptLimiter;
    const [account, address] = await Promise.all([
      reserveAttempt(limiter, [SIGN_IN_ACCOUNT_POLICY], Email.parse(email).value),
      reserveAttempt(limiter, [SIGN_IN_IP_POLICY], ip),
    ]);
    const attempt: ReservedAttempt = {
      allowed: account.allowed && address.allowed,
      reservations: [...account.reservations, ...address.reservations],
    };
    if (!attempt.allowed) {
      // Refused before any Argon2id work: not a guess, so it does not count either.
      await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
      throw new RateLimited();
    }

    let matches: boolean;
    try {
      matches = await this.deps.passwordHasher.verify(passwordHash, password);
    } catch (error) {
      // A fault is not a failed guess either.
      await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
      throw error;
    }
    if (!matches) throw new InvalidCredentials();
    await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
  }

  /**
   * A TOTP or recovery code, limited with the policies of disabling 2FA. The code is spent here,
   * before the deletion transaction (A-12): a deletion that then loses a race has burned one code.
   */
  private async checkSecondFactor(
    user: User,
    settings: TwoFactorSettings,
    code: string | undefined,
  ): Promise<void> {
    // Not a guess, so nothing is reserved.
    if (code === undefined) throw new TotpInvalid();

    const limiter = this.deps.attemptLimiter;
    const attempt = await reserveAttempt(limiter, TWO_FACTOR_DISABLE_POLICIES, user.id);
    if (!attempt.allowed) {
      // Refused without checking the code: not a guess, so it does not count either.
      await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
      throw new RateLimited();
    }

    const parsed = parseSecondFactorCode(code);
    let valid: boolean;
    try {
      valid =
        parsed !== null &&
        (await checkSecondFactorCode(
          this.deps,
          this.deps,
          settings,
          parsed,
          this.deps.clock.now(),
        ));
    } catch (error) {
      // No encryption key or a fault: the units go back and the error stands.
      await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
      throw error;
    }
    if (!valid) {
      // A deletion or a credentials change that committed meanwhile removed what the check
      // looked for: not a guess, and the account is not the one this request authenticated.
      let current: User | null;
      try {
        current = await this.deps.users.findById(user.id);
      } catch (error) {
        // A fault is not a failed guess either: the units go back and the error stands.
        await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
        throw error;
      }
      if (!current || current.credentialsVersion !== user.credentialsVersion) {
        await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
        throw new Unauthenticated();
      }
      // A wrong code keeps its units and also counts toward the sign-in limit (NFR-01).
      await recordSignInFailure(limiter, user.email, this.deps.reportRecordFailure);
      throw new TotpInvalid();
    }
    await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
  }
}
