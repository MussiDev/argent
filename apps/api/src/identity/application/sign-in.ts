import { Email } from '../domain/email';
import { RateLimited } from '../domain/errors';
import { UNKNOWN_IP } from './client-ip';
import type { AccessTokenIssuer } from './ports/access-token-issuer';
import type { AttemptLimiter, AttemptPolicy, AttemptResult } from './ports/attempt-limiter';
import type { Clock } from './ports/clock';
import type { PasswordHasher } from './ports/password-hasher';
import type { SessionRepository } from './ports/session-repository';
import type { TokenGenerator } from './ports/token-generator';
import type { User, UserRepository } from './ports/user-repository';

const FIFTEEN_MINUTES = 15 * 60;

/** NFR-03 / threat R-01: 5 failed sign-ins per account (normalized email) per 15 minutes. */
export const SIGN_IN_ACCOUNT_POLICY: AttemptPolicy = {
  kind: 'sign_in_account',
  limit: 5,
  windowSeconds: FIFTEEN_MINUTES,
};

/** NFR-03 / threat R-01: 20 failed sign-ins per client IP per 15 minutes. */
export const SIGN_IN_IP_POLICY: AttemptPolicy = {
  kind: 'sign_in_ip',
  limit: 20,
  windowSeconds: FIFTEEN_MINUTES,
};

/** The secrets of a freshly started or rotated session; only ever sent to the client as cookies. */
export interface SessionTokens {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  /** Lifetime of the access token, in seconds. */
  accessTokenTtlSeconds: number;
}

export interface SignInDependencies {
  attemptLimiter: AttemptLimiter;
  users: UserRepository;
  passwordHasher: PasswordHasher;
  /** A real hash of an unknown password, verified for unknown emails so both paths cost the same. */
  dummyPasswordHash: string;
  sessions: SessionRepository;
  tokenGenerator: TokenGenerator;
  accessTokens: AccessTokenIssuer;
  clock: Clock;
  /**
   * Told when the refund after a successful sign-in fails. The sign-in still succeeds: the leaked
   * units only make the limiter stricter (fail safe). Must not log secrets.
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
 * or not the email exists (R-02).
 */
export type SignInResult =
  | { outcome: 'signed_in'; user: User; session: SessionTokens }
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
      // Refused without hashing: the attempt is not a guess, so it does not count either.
      await this.refund(reservations);
      throw new RateLimited();
    }

    const user = await this.deps.users.findByEmail(email);
    // Unknown emails verify the dummy hash, so both paths do the same work (NFR-08).
    const matches = await this.deps.passwordHasher.verify(
      user?.passwordHash ?? this.deps.dummyPasswordHash,
      input.password,
    );
    // A failure keeps its reserved units.
    if (!user || !matches) return { outcome: 'invalid_credentials', userId: user?.id ?? null };
    // Only failures count: a successful sign-in gives its units back. A failed refund must not
    // turn a correct password into an error; it is reported and the sign-in goes on.
    try {
      await this.refund(reservations);
    } catch (error) {
      this.deps.reportRefundFailure(error);
    }

    // Unverified users get a session too: they need one to resend the verification email.
    const refreshToken = this.deps.tokenGenerator.generate();
    const session = await this.deps.sessions.create({
      userId: user.id,
      refreshTokenHash: this.deps.tokenGenerator.hash(refreshToken),
      lastUsedAt: this.deps.clock.now(),
      // Read in the same row as the hash that was verified: if a reset commits meanwhile, this
      // session is created stale and rejected on first use (AC-10).
      credentialsVersion: user.credentialsVersion,
    });
    const accessToken = await this.deps.accessTokens.issue({
      userId: user.id,
      sessionId: session.id,
    });
    return {
      outcome: 'signed_in',
      user,
      session: {
        sessionId: session.id,
        accessToken,
        refreshToken,
        accessTokenTtlSeconds: this.deps.accessTokens.ttlSeconds,
      },
    };
  }

  /** Gives back exactly the reserved units, in the windows they were recorded in. */
  private async refund({ accountKey, ip, account, address }: Reservations): Promise<void> {
    await Promise.all([
      this.deps.attemptLimiter.release(SIGN_IN_ACCOUNT_POLICY, accountKey, account.windowStart),
      this.deps.attemptLimiter.release(SIGN_IN_IP_POLICY, ip, address.windowStart),
    ]);
  }
}
