import { Email } from '../domain/email';
import { RateLimited } from '../domain/errors';
import { UNKNOWN_IP } from './client-ip';
import { SIGN_IN_ACCOUNT_POLICY, SIGN_IN_IP_POLICY } from './attempt-policies';
import type { CreateSignInChallenge } from './create-sign-in-challenge';
import type { AttemptLimiter, AttemptResult } from './ports/attempt-limiter';
import type { PasswordHasher } from './ports/password-hasher';
import type { TwoFactorRepository } from './ports/two-factor-repository';
import type { User, UserRepository } from './ports/user-repository';
import type { SessionTokens, StartSession } from './start-session';

export interface SignInDependencies {
  attemptLimiter: AttemptLimiter;
  users: UserRepository;
  passwordHasher: PasswordHasher;
  /** A real hash of an unknown password, verified for unknown emails so both paths cost the same. */
  dummyPasswordHash: string;
  startSession: StartSession;
  /** Whether the user has 2FA on (PRD 01c FR-04). */
  twoFactor: TwoFactorRepository;
  createSignInChallenge: CreateSignInChallenge;
  /**
   * Told when a refund fails, after a successful sign-in or a rate-limited refusal. The outcome is
   * unchanged (signed in, or 429): the leaked units only make the limiter stricter (fail safe).
   * Must not log secrets.
   */
  reportRefundFailure: (error: unknown) => void;
}

export interface SignInInput {
  email: string;
  password: string;
  ip: string | undefined;
}

/**
 * `invalid_credentials` carries the user id only for logging: the HTTP answer is the same whether
 * or not the email exists (R-02). `second_factor_required` starts no session: the challenge token
 * goes to the browser in a cookie, and the user only to the logs.
 */
export type SignInResult =
  | { outcome: 'signed_in'; user: User; session: SessionTokens }
  | { outcome: 'second_factor_required'; user: User; challengeToken: string }
  | { outcome: 'invalid_credentials'; userId: string | null };

/** The two units a sign-in attempt holds until it knows whether it counts. */
interface Reservations {
  accountKey: string;
  ip: string;
  account: AttemptResult;
  address: AttemptResult;
}

export class SignIn {
  constructor(private readonly deps: SignInDependencies) {}

  async execute(input: SignInInput): Promise<SignInResult> {
    const email = Email.parse(input.email);
    const ip = input.ip ?? UNKNOWN_IP;

    // Reserve-then-refund: one unit per key is taken BEFORE any Argon2id work (R-04). The upsert
    // is atomic, so N parallel requests share at most `limit` guesses (R-01), and known and
    // unknown emails do the same work (NFR-08).
    const [account, address] = await Promise.all([
      this.deps.attemptLimiter.record(SIGN_IN_ACCOUNT_POLICY, email.value),
      this.deps.attemptLimiter.record(SIGN_IN_IP_POLICY, ip),
    ]);
    const reservations: Reservations = { accountKey: email.value, ip, account, address };
    if (!account.allowed || !address.allowed) {
      // Refused without hashing: the attempt is not a guess, so it does not count either. A failed
      // refund must not turn the refusal into an error.
      try {
        await this.refund(reservations);
      } catch (error) {
        this.deps.reportRefundFailure(error);
      }
      throw new RateLimited();
    }

    const user = await this.deps.users.findByEmail(email);
    // Unknown emails and password-less (Google-created) users verify the dummy hash, so every path
    // does the same work (NFR-08).
    const matches = await this.deps.passwordHasher.verify(
      user?.passwordHash ?? this.deps.dummyPasswordHash,
      input.password,
    );
    // A password-less user never signs in with a password, even if the dummy preimage matches.
    // A failure keeps its reserved units.
    if (!user || user.passwordHash === null || !matches) {
      return { outcome: 'invalid_credentials', userId: user?.id ?? null };
    }
    // Only failures count: a successful sign-in gives its units back. A failed refund must not
    // turn a correct password into an error; it is reported and the sign-in goes on.
    try {
      await this.refund(reservations);
    } catch (error) {
      this.deps.reportRefundFailure(error);
    }

    // Read after the user row: a 2FA enable that bumped the version after that read makes the
    // session or the challenge below stale, never a new version paired with "no 2FA" (01c).
    const twoFactor = await this.deps.twoFactor.findByUserId(user.id);
    if (twoFactor?.enabledAt) {
      const challengeToken = await this.deps.createSignInChallenge.execute({
        userId: user.id,
        credentialsVersion: user.credentialsVersion,
        via: 'password',
        language: user.language,
      });
      return { outcome: 'second_factor_required', user, challengeToken };
    }

    // Unverified users get a session too: they need one to resend the verification email. The
    // credentials version comes from the same row as the hash that was verified (AC-10).
    const session = await this.deps.startSession.execute(user);
    return { outcome: 'signed_in', user, session };
  }

  /** Gives back exactly the reserved units, in the windows they were recorded in. */
  private async refund({ accountKey, ip, account, address }: Reservations): Promise<void> {
    await Promise.all([
      this.deps.attemptLimiter.release(SIGN_IN_ACCOUNT_POLICY, accountKey, account.windowStart),
      this.deps.attemptLimiter.release(SIGN_IN_IP_POLICY, ip, address.windowStart),
    ]);
  }
}
