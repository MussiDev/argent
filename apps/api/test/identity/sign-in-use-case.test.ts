import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessTokenIssuer } from '../../src/identity/application/ports/access-token-issuer';
import type { AttemptLimiter } from '../../src/identity/application/ports/attempt-limiter';
import type { PasswordHasher } from '../../src/identity/application/ports/password-hasher';
import type {
  NewSession,
  Session,
  SessionRepository,
} from '../../src/identity/application/ports/session-repository';
import type { User, UserRepository } from '../../src/identity/application/ports/user-repository';
import { CreateSignInChallenge } from '../../src/identity/application/create-sign-in-challenge';
import { SignIn } from '../../src/identity/application/sign-in';
import { StartSession } from '../../src/identity/application/start-session';
import { RateLimited } from '../../src/identity/domain/errors';
import { PostgresAttemptLimiter } from '../../src/identity/infrastructure/db/postgres-attempt-limiter';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { MutableClock } from '../fakes/mutable-clock';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const EMAIL = 'ana@example.com';
const IP = '203.0.113.9';
const JUST_BEFORE_BOUNDARY = new Date('2026-09-26T12:14:59.999Z');

const user: User = {
  id: '00000000-0000-4000-8000-000000000001',
  email: EMAIL,
  passwordHash: 'stored-hash',
  emailVerifiedAt: JUST_BEFORE_BOUNDARY,
  defaultRateType: 'mep',
  displayCurrency: 'ARS',
  timeZone: 'America/Cordoba',
  language: 'es',
  createdAt: JUST_BEFORE_BOUNDARY,
  credentialsVersion: 4,
  passwordChangedAt: null,
};

/** SignIn with the real PostgreSQL limiter and fakes for everything else. */
function buildSignIn(options: {
  clock: MutableClock;
  attemptLimiter?: AttemptLimiter;
  /** Runs while the password is being verified, i.e. between reserve and refund. */
  duringHash?: () => void;
  reportRefundFailure?: (error: unknown) => void;
  /** Receives every session the sign-in asks to create. */
  created?: NewSession[];
  /** The account found for the email; defaults to a user with a password. */
  account?: User;
  /** Receives every hash the sign-in verifies against. */
  verifiedHashes?: string[];
}) {
  const account = options.account ?? user;
  const users: UserRepository = {
    create: () => Promise.reject(new Error('unused')),
    findById: () => Promise.resolve(account),
    findByEmail: () => Promise.resolve(account),
    markEmailVerified: () => Promise.resolve(),
    changePassword: () => Promise.resolve(),
    supersedeUnverified: () => Promise.reject(new Error('unused')),
    bumpCredentialsVersion: () => Promise.reject(new Error('unused')),
  };
  const passwordHasher: PasswordHasher = {
    hash: () => Promise.reject(new Error('unused')),
    verify: (passwordHash) => {
      options.verifiedHashes?.push(passwordHash);
      options.duringHash?.();
      return Promise.resolve(true);
    },
  };
  const sessions: SessionRepository = {
    create: (session) => {
      options.created?.push(session);
      return Promise.resolve({
        id: '00000000-0000-4000-8000-0000000000aa',
        familyId: '00000000-0000-4000-8000-0000000000aa',
        createdAt: options.clock.now(),
        revokedAt: null,
        replacedBy: null,
        ...session,
      } as Session);
    },
    findById: () => Promise.resolve(null),
    findByRefreshTokenHash: () => Promise.resolve(null),
    markReplaced: () => Promise.resolve(true),
    revoke: () => Promise.resolve(),
    revokeFamily: () => Promise.resolve(),
    revokeAllForUser: () => Promise.resolve(),
  };
  const accessTokens: AccessTokenIssuer = {
    ttlSeconds: 900,
    issue: () => Promise.resolve('jwt'),
    verify: () => Promise.resolve(null),
  };
  return new SignIn({
    attemptLimiter:
      options.attemptLimiter ?? new PostgresAttemptLimiter(connection.db, options.clock),
    users,
    passwordHasher,
    dummyPasswordHash: 'dummy-hash',
    startSession: new StartSession({
      sessions,
      tokenGenerator: { generate: () => 'refresh-token', hash: (token) => `hash:${token}` },
      accessTokens,
      clock: options.clock,
    }),
    // No 2FA: these tests are about the limiter around the password check.
    twoFactor: {
      findByUserId: () => Promise.resolve(null),
      savePending: () => Promise.reject(new Error('unused')),
      activate: () => Promise.reject(new Error('unused')),
      advanceLastUsedStep: () => Promise.reject(new Error('unused')),
      delete: () => Promise.reject(new Error('unused')),
    },
    createSignInChallenge: new CreateSignInChallenge({
      signInChallenges: {
        create: () => Promise.reject(new Error('unused')),
        findLive: () => Promise.reject(new Error('unused')),
        lockLive: () => Promise.reject(new Error('unused')),
        recordAttempt: () => Promise.reject(new Error('unused')),
        consume: () => Promise.reject(new Error('unused')),
        deleteForUser: () => Promise.reject(new Error('unused')),
      },
      tokenGenerator: { generate: () => 'challenge-token', hash: (token) => `hash:${token}` },
      clock: options.clock,
    }),
    reportRefundFailure: options.reportRefundFailure ?? (() => undefined),
  });
}

async function attemptRows() {
  const result = await connection.pool.query<{ kind: string; window_start: Date; count: number }>(
    'select kind, window_start, count from auth_attempts order by kind, window_start',
  );
  return result.rows;
}

describe('SignIn limiter reservations', () => {
  it('refunds the window it reserved in, even when the clock crosses the boundary meanwhile (B-2)', async () => {
    const clock = new MutableClock(new Date('2026-09-26T12:15:00.000Z'));
    const limiter = new PostgresAttemptLimiter(connection.db, clock);
    // Two failures already recorded in the 12:15 window for this account and IP.
    for (let i = 0; i < 2; i += 1) {
      await limiter.record({ kind: 'sign_in_account', limit: 5, windowSeconds: 900 }, EMAIL);
      await limiter.record({ kind: 'sign_in_ip', limit: 20, windowSeconds: 900 }, IP);
    }
    clock.advance(JUST_BEFORE_BOUNDARY.getTime() - clock.now().getTime());
    const signIn = buildSignIn({
      clock,
      duringHash: () => {
        clock.advance(2);
      },
    });

    const result = await signIn.execute({ email: EMAIL, password: 'right one', ip: IP });

    expect(result.outcome).toBe('signed_in');
    const W1200 = new Date('2026-09-26T12:00:00.000Z');
    const W1215 = new Date('2026-09-26T12:15:00.000Z');
    expect(await attemptRows()).toEqual([
      { kind: 'sign_in_account', window_start: W1200, count: 0 },
      { kind: 'sign_in_account', window_start: W1215, count: 2 },
      { kind: 'sign_in_ip', window_start: W1200, count: 0 },
      { kind: 'sign_in_ip', window_start: W1215, count: 2 },
    ]);
  });

  it('still signs the user in when the success refund fails, and reports the failure (A-9)', async () => {
    const clock = new MutableClock(new Date('2026-09-26T13:00:00.000Z'));
    const real = new PostgresAttemptLimiter(connection.db, clock);
    const failure = new Error('database unavailable');
    const failingRelease: AttemptLimiter = {
      isLimitReached: (policy, key) => real.isLimitReached(policy, key),
      record: (policy, key) => real.record(policy, key),
      release: () => Promise.reject(failure),
    };
    const reported: unknown[] = [];
    const signIn = buildSignIn({
      clock,
      attemptLimiter: failingRelease,
      reportRefundFailure: (error) => reported.push(error),
    });

    const result = await signIn.execute({ email: EMAIL, password: 'right one', ip: IP });

    expect(result.outcome).toBe('signed_in');
    // Reported once for the refund as a whole; the leaked units fail safe (they only restrict).
    expect(reported).toEqual([failure]);
    expect((await attemptRows()).map((row) => row.count)).toEqual([1, 1]);
  });

  /** A limiter that refuses every attempt, with a refund that resolves or rejects as asked. */
  function refusingLimiter(release: () => Promise<void>): AttemptLimiter {
    return {
      isLimitReached: () => Promise.resolve(true),
      record: () =>
        Promise.resolve({
          count: 6,
          allowed: false,
          windowStart: new Date('2026-09-26T15:00:00.000Z'),
        }),
      release,
    };
  }

  it('answers 429 RateLimited and reports the failure when the refund of a refused attempt fails (FIX-001 AC-04)', async () => {
    const failure = new Error('database unavailable');
    const reported: unknown[] = [];
    const signIn = buildSignIn({
      clock: new MutableClock(new Date('2026-09-26T15:00:00.000Z')),
      attemptLimiter: refusingLimiter(() => Promise.reject(failure)),
      reportRefundFailure: (error) => reported.push(error),
    });

    await expect(
      signIn.execute({ email: EMAIL, password: 'right one', ip: IP }),
    ).rejects.toBeInstanceOf(RateLimited);
    expect(reported).toEqual([failure]);
  });

  it('answers 429 RateLimited without reporting anything when the refund of a refused attempt succeeds (FIX-001 AC-05)', async () => {
    const reported: unknown[] = [];
    const signIn = buildSignIn({
      clock: new MutableClock(new Date('2026-09-26T15:00:00.000Z')),
      attemptLimiter: refusingLimiter(() => Promise.resolve()),
      reportRefundFailure: (error) => reported.push(error),
    });

    await expect(
      signIn.execute({ email: EMAIL, password: 'right one', ip: IP }),
    ).rejects.toBeInstanceOf(RateLimited);
    expect(reported).toEqual([]);
  });

  it("stores the user's credentials version, read with the password hash, on the new session", async () => {
    const created: NewSession[] = [];
    const signIn = buildSignIn({
      clock: new MutableClock(new Date('2026-09-26T14:00:00.000Z')),
      created,
    });

    const result = await signIn.execute({ email: EMAIL, password: 'right one', ip: IP });

    expect(result.outcome).toBe('signed_in');
    expect(created).toEqual([expect.objectContaining({ userId: user.id, credentialsVersion: 4 })]);
  });

  it('refuses a password-less (Google-created) user even when the dummy hash matches, keeping the reserved units (SAST M-1)', async () => {
    const created: NewSession[] = [];
    const verifiedHashes: string[] = [];
    const signIn = buildSignIn({
      clock: new MutableClock(new Date('2026-09-26T16:00:00.000Z')),
      account: { ...user, passwordHash: null },
      created,
      verifiedHashes,
    });

    const result = await signIn.execute({ email: EMAIL, password: 'dummy preimage', ip: IP });

    expect(result).toEqual({ outcome: 'invalid_credentials', userId: user.id });
    expect(created).toEqual([]);
    // The dummy hash is still verified, so the refusal costs the same as a wrong password.
    expect(verifiedHashes).toEqual(['dummy-hash']);
    // A failure keeps its reserved units (FIX-001).
    expect((await attemptRows()).map((row) => row.count)).toEqual([1, 1]);
  });
});
