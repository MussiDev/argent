import { RateLimited } from '../domain/errors';
import { SECOND_FACTOR_POLICIES } from './attempt-policies';
import type { AttemptLimiter } from './ports/attempt-limiter';
import type { Clock } from './ports/clock';
import type { PasswordHasher } from './ports/password-hasher';
import type { SecretBox } from './ports/secret-box';
import type {
  SignInChallenge,
  SignInChallengeRepository,
  SignInVia,
} from './ports/sign-in-challenge-repository';
import type { TokenGenerator } from './ports/token-generator';
import type { TotpEngine } from './ports/totp';
import type { TransactionalRepositories, UnitOfWork } from './ports/unit-of-work';
import type { User } from './ports/user-repository';
import {
  checkSecondFactorCode,
  parseSecondFactorCode,
  recordSignInFailure,
  refundAttempt,
  reserveAttempt,
  type ReservedAttempt,
  type SecondFactorCode,
} from './second-factor-limits';
import type { SessionTokens, StartSession } from './start-session';

/** At most this many codes are checked against one challenge (01c NFR-04, threat R-40). */
export const MAX_CHALLENGE_ATTEMPTS = 5;

export interface VerifySecondFactorDependencies {
  /** Pool-bound: the unlocked read that learns the challenge's user. */
  signInChallenges: SignInChallengeRepository;
  tokenGenerator: TokenGenerator;
  attemptLimiter: AttemptLimiter;
  unitOfWork: UnitOfWork;
  startSession: StartSession;
  totp: TotpEngine;
  secretBox: SecretBox;
  /** Argon2id, to check recovery codes against their hashes. */
  passwordHasher: PasswordHasher;
  clock: Clock;
  /** Told when a refund fails; the answer is unchanged (fail safe). */
  reportRefundFailure: (error: unknown) => void;
  /** Told when the NFR-01 unit of a wrong code could not be recorded; the 401 is unchanged. */
  reportRecordFailure: (error: unknown) => void;
}

export interface VerifySecondFactorInput {
  /** The challenge cookie, if the browser sent one. */
  challengeToken: string | undefined;
  /** A TOTP code or a recovery code, as typed. */
  code: string;
}

/** Why a challenge could not be used; for logs only, the answer is the same. */
export type ExpiredReason =
  'missing' | 'gone' | 'too_many_attempts' | 'credentials_changed' | 'two_factor_off';

/**
 * `expired` and `invalid` carry the user id only for logging. The route answers them 401
 * `SECOND_FACTOR_EXPIRED` and 401 `SECOND_FACTOR_INVALID`. `via` is the first factor of the
 * challenge (null when there was no live challenge), for logs.
 */
export type VerifySecondFactorResult =
  | { outcome: 'signed_in'; via: SignInVia; user: User; session: SessionTokens }
  | { outcome: 'expired'; reason: ExpiredReason; userId: string | null; via: SignInVia | null }
  | { outcome: 'invalid'; userId: string; via: SignInVia };

/**
 * What the locked unit of work decided. Every expected result is an outcome, never a throw, so the
 * transaction commits and the attempt count and consumes persist.
 */
type ChallengeOutcome =
  | { outcome: 'ok'; user: User; challenge: SignInChallenge }
  | { outcome: 'expired'; reason: ExpiredReason }
  | { outcome: 'invalid'; user: User };

/**
 * The second step of a sign-in (PRD 01c FR-04, AC-04, AC-05): a valid TOTP code (never reused) or an
 * unused recovery code turns a live challenge into a session. A missing, expired, used up or stale
 * challenge is `expired`; a wrong code is `invalid` and counted. Rejects with `RateLimited` over the
 * per-user limits and with `TwoFactorUnavailable` without an encryption key.
 *
 * No pool connection is requested while the challenge lock is held: the limiter and the session
 * start run before and after the unit of work (no pool deadlock under concurrency).
 */
export class VerifySecondFactor {
  constructor(private readonly deps: VerifySecondFactorDependencies) {}

  async execute({
    challengeToken,
    code,
  }: VerifySecondFactorInput): Promise<VerifySecondFactorResult> {
    if (!challengeToken) {
      return { outcome: 'expired', reason: 'missing', userId: null, via: null };
    }
    const tokenHash = this.deps.tokenGenerator.hash(challengeToken);

    // 1. Unlocked read, only to learn whose limits apply.
    const live = await this.deps.signInChallenges.findLive(tokenHash, this.deps.clock.now());
    if (!live) return { outcome: 'expired', reason: 'gone', userId: null, via: null };

    // 2. NFR-04, reserve-then-refund, outside any transaction.
    const limiter = this.deps.attemptLimiter;
    const attempt = await reserveAttempt(limiter, SECOND_FACTOR_POLICIES, live.userId);
    if (!attempt.allowed) {
      // Refused without checking: not a guess, so it does not count either.
      await this.refund(attempt);
      throw new RateLimited();
    }

    // 3-4. One unit of work under the challenge lock.
    let decided: ChallengeOutcome;
    try {
      decided = await this.deps.unitOfWork.run((repositories) =>
        this.decide(repositories, tokenHash, parseSecondFactorCode(code)),
      );
    } catch (error) {
      // No key, a tampered secret or a fault: not a guess, so the units go back.
      await this.refund(attempt);
      throw error;
    }

    // 5. After commit, with the lock released.
    if (decided.outcome === 'expired') {
      await this.refund(attempt);
      return { outcome: 'expired', reason: decided.reason, userId: live.userId, via: live.via };
    }
    if (decided.outcome === 'invalid') {
      // A failed guess keeps its units and also counts toward the sign-in limit (NFR-01).
      await recordSignInFailure(limiter, decided.user.email, this.deps.reportRecordFailure);
      return { outcome: 'invalid', userId: decided.user.id, via: live.via };
    }
    let session: SessionTokens;
    try {
      // The version the first factor was checked with: a change committed since makes this
      // session stale on first use.
      session = await this.deps.startSession.execute({
        id: decided.user.id,
        credentialsVersion: decided.challenge.credentialsVersion,
      });
    } finally {
      // Only failed guesses keep their units.
      await this.refund(attempt);
    }
    return { outcome: 'signed_in', via: decided.challenge.via, user: decided.user, session };
  }

  private async decide(
    { signInChallenges, users, twoFactor, recoveryCodes }: TransactionalRepositories,
    tokenHash: string,
    code: SecondFactorCode | null,
  ): Promise<ChallengeOutcome> {
    const now = this.deps.clock.now();
    // Consumed or expired since the unlocked read (e.g. a concurrent verify that succeeded).
    const challenge = await signInChallenges.lockLive(tokenHash, now);
    if (!challenge) return { outcome: 'expired', reason: 'gone' };

    const attempts = await signInChallenges.recordAttempt(tokenHash);
    if (attempts > MAX_CHALLENGE_ATTEMPTS) {
      await signInChallenges.consume(tokenHash);
      return { outcome: 'expired', reason: 'too_many_attempts' };
    }

    const user = await users.findById(challenge.userId);
    if (!user || user.credentialsVersion !== challenge.credentialsVersion) {
      // A password reset or a 2FA change since the first factor (threat R-44).
      await signInChallenges.consume(tokenHash);
      return { outcome: 'expired', reason: 'credentials_changed' };
    }
    const settings = await twoFactor.findByUserId(user.id);
    if (!settings?.enabledAt) {
      await signInChallenges.consume(tokenHash);
      return { outcome: 'expired', reason: 'two_factor_off' };
    }

    // The only expensive work under the lock: at most 10 sequential Argon2id checks (R-45).
    const valid =
      code !== null &&
      (await checkSecondFactorCode(this.deps, { twoFactor, recoveryCodes }, settings, code, now));
    if (!valid) return { outcome: 'invalid', user };

    await signInChallenges.consume(tokenHash);
    return { outcome: 'ok', user, challenge };
  }

  private refund(attempt: ReservedAttempt): Promise<void> {
    return refundAttempt(this.deps.attemptLimiter, attempt, this.deps.reportRefundFailure);
  }
}
