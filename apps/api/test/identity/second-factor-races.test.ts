import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIdentityInfrastructure } from '../../src/identity';
import type { PasswordHasher } from '../../src/identity/application/ports/password-hasher';
import type { UnitOfWork } from '../../src/identity/application/ports/unit-of-work';
import { StartSession } from '../../src/identity/application/start-session';
import { VerifySecondFactor } from '../../src/identity/application/verify-second-factor';
import { Argon2idPasswordHasher } from '../../src/identity/infrastructure/security/argon2id-password-hasher';
import { JoseAccessTokenIssuer } from '../../src/identity/infrastructure/security/jose-access-token-issuer';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness, type IdentityHarness } from '../helpers/identity-harness';
import {
  cookieHeader,
  currentSession,
  seedUser,
  sessionFrom,
  signIn,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { TEST_TOTP_ENCRYPTION_KEY, testEnv, trustedHeaders } from '../helpers/test-env';
import {
  challengeFrom,
  seedTwoFactor,
  STEP_MS,
  totpNow,
  UNKNOWN_RECOVERY_CODE,
  unusedRecoveryCodes,
  verifySecondFactor,
} from '../helpers/two-factor-client';

/** node-postgres' default pool size, which is what the API runs with. */
const POOL_SIZE = 10;
const PASSWORD = 'a long enough passphrase';
const FIFTEEN_MINUTES = 15 * 60 * 1000;

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

function harnessOn(target: DatabaseConnection): IdentityHarness {
  const harness = createIdentityHarness(target, { realSessions: true });
  const now = harness.clock.now().getTime();
  harness.clock.advance(FIFTEEN_MINUTES - (now % FIFTEEN_MINUTES));
  return harness;
}

async function firstFactor(harness: IdentityHarness, email: string): Promise<string> {
  const response = await signIn(harness.app, email, PASSWORD);
  expect(response.body).toEqual({ status: 'second_factor_required' });
  return challengeFrom(response);
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(sql, params);
  return Number(result.rows[0]?.n ?? 0);
}

function sessionCount(userId?: string): Promise<number> {
  return userId === undefined
    ? count('select count(*) as n from sessions')
    : count('select count(*) as n from sessions where user_id = $1', [userId]);
}

function lastUsedStep(userId: string): Promise<number> {
  return count('select last_used_step as n from user_two_factor where user_id = $1', [userId]);
}

describe('concurrent second-factor verifies (threat R-44)', () => {
  it('12 concurrent verifies against a pool of 10 connections all complete (no pool deadlock) (sad path)', async () => {
    const pooled = createDatabase(testDatabaseUrl);
    try {
      expect(pooled.pool.options.max).toBe(POOL_SIZE);
      const harness = harnessOn(pooled);
      // Three users with four requests each: within the per-user limit, so all twelve reach the
      // challenge lock, more than the pool has connections. Wrong recovery codes keep the lock
      // busy with Argon2id checks while the others wait on it holding their connections.
      const users: { userId: string; secret: string; challenge: string }[] = [];
      for (let n = 0; n < 3; n += 1) {
        const email = `user${n}@example.com`;
        const userId = await seedUser(connection, { email, password: PASSWORD });
        const { secret } = await seedTwoFactor(connection, userId, harness.clock);
        users.push({ userId, secret, challenge: await firstFactor(harness, email) });
      }

      const responses = await Promise.all(
        users.flatMap(({ secret, challenge }) => [
          verifySecondFactor(harness.app, challenge, UNKNOWN_RECOVERY_CODE),
          verifySecondFactor(harness.app, challenge, UNKNOWN_RECOVERY_CODE),
          verifySecondFactor(harness.app, challenge, UNKNOWN_RECOVERY_CODE),
          verifySecondFactor(harness.app, challenge, totpNow(secret, harness.clock)),
        ]),
      );

      expect(responses).toHaveLength(12);
      for (const response of responses) {
        expect([200, 401]).toContain(response.status);
      }
      // Each user's valid code got exactly one session, whatever the order.
      for (const { userId } of users) expect(await sessionCount(userId)).toBe(1);
      expect(responses.filter((response) => response.status === 200)).toHaveLength(3);
    } finally {
      await pooled.pool.end();
    }
  }, 60_000);

  it('two concurrent verifies with the same valid code start exactly one session and spend the code once (sad path)', async () => {
    const harness = harnessOn(connection);
    const userId = await seedUser(connection, { email: 'ana@example.com', password: PASSWORD });
    const { secret } = await seedTwoFactor(connection, userId, harness.clock);
    const challenge = await firstFactor(harness, 'ana@example.com');
    const code = totpNow(secret, harness.clock);

    const responses = await Promise.all([
      verifySecondFactor(harness.app, challenge, code),
      verifySecondFactor(harness.app, challenge, code),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const refused = responses.find((response) => response.status === 401);
    expect(refused?.body).toMatchObject({ code: 'SECOND_FACTOR_EXPIRED' });
    expect(await sessionCount()).toBe(1);
    expect(await lastUsedStep(userId)).toBe(Math.floor(harness.clock.now().getTime() / STEP_MS));
    expect(await count('select count(*) as n from sign_in_challenges')).toBe(0);
  });

  it('two concurrent verifies, one with a TOTP code and one with a recovery code, start exactly one session and spend at most one code (sad path)', async () => {
    const harness = harnessOn(connection);
    const userId = await seedUser(connection, { email: 'ana@example.com', password: PASSWORD });
    const { secret, recoveryCodes } = await seedTwoFactor(connection, userId, harness.clock);
    const challenge = await firstFactor(harness, 'ana@example.com');

    const responses = await Promise.all([
      verifySecondFactor(harness.app, challenge, totpNow(secret, harness.clock)),
      verifySecondFactor(harness.app, challenge, recoveryCodes[9] ?? ''),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    expect(await sessionCount()).toBe(1);
    const totpSpent = (await lastUsedStep(userId)) > 0 ? 1 : 0;
    const recoverySpent = 10 - (await unusedRecoveryCodes(connection, userId));
    expect(totpSpent + recoverySpent).toBe(1);
  });
});

// --- Use-case level ------------------------------------------------------------------------------

interface VerifyOverrides {
  passwordHasher?: PasswordHasher;
  unitOfWork?: UnitOfWork;
  refundFailures?: unknown[];
}

/** VerifySecondFactor on the test database, sharing the harness clock and JWT secret. */
function verifyUseCase(harness: IdentityHarness, overrides: VerifyOverrides = {}) {
  const infrastructure = createIdentityInfrastructure({
    db: connection.db,
    env: { BREACH_CHECKER: 'fake', TOTP_ENCRYPTION_KEY: TEST_TOTP_ENCRYPTION_KEY },
    logger: createLogger({ level: 'silent' }),
    clock: harness.clock,
  });
  const accessTokens = new JoseAccessTokenIssuer({
    secret: testEnv().JWT_SECRET,
    clock: harness.clock,
  });
  return new VerifySecondFactor({
    signInChallenges: infrastructure.signInChallenges,
    tokenGenerator: infrastructure.tokenGenerator,
    attemptLimiter: infrastructure.attemptLimiter,
    unitOfWork: overrides.unitOfWork ?? infrastructure.unitOfWork,
    startSession: new StartSession({
      sessions: infrastructure.sessions,
      tokenGenerator: infrastructure.tokenGenerator,
      accessTokens,
      clock: harness.clock,
    }),
    totp: infrastructure.totp,
    secretBox: infrastructure.secretBox,
    passwordHasher: overrides.passwordHasher ?? infrastructure.passwordHasher,
    clock: harness.clock,
    reportRefundFailure: (error) => overrides.refundFailures?.push(error),
    reportRecordFailure: () => undefined,
  });
}

interface Latch {
  promise: Promise<void>;
  open: () => void;
}

function latch(): Latch {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Resolves once some statement on the test database is waiting for a row lock. */
async function untilSomeoneWaitsForALock(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await connection.pool.query<{ n: string }>(
      "select count(*) as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
    );
    if (Number(result.rows[0]?.n) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('no statement ever waited for a lock');
}

function secondFactorUnits(userId: string): Promise<number> {
  return count(
    "select coalesce(sum(count), 0) as n from auth_attempts where kind in ('second_factor_user_15m', 'second_factor_user_24h') and key = $1",
    [userId],
  );
}

describe('verify against a concurrent disable (threat R-44)', () => {
  it('a disable that runs while a verify holds the challenge lock waits for it: no deadlock, no 500, the verify signs in and the disable ends that session (sad path)', async () => {
    const harness = harnessOn(connection);
    const userId = await seedUser(connection, { email: 'ana@example.com', password: PASSWORD });
    const { secret, recoveryCodes } = await seedTwoFactor(connection, userId, harness.clock);
    const signedIn = await verifySecondFactor(
      harness.app,
      await firstFactor(harness, 'ana@example.com'),
      totpNow(secret, harness.clock),
    );
    expect(signedIn.status).toBe(200);
    const cookies = sessionFrom(signedIn);
    harness.clock.advance(STEP_MS);
    const challenge = await firstFactor(harness, 'ana@example.com');

    // The verify locks the challenge and then waits in its first recovery-code check.
    const checking = latch();
    const release = latch();
    const real = new Argon2idPasswordHasher();
    let first = true;
    const slowHasher: PasswordHasher = {
      hash: (password) => real.hash(password),
      verify: async (passwordHash, password) => {
        if (first) {
          first = false;
          checking.open();
          await release.promise;
        }
        return real.verify(passwordHash, password);
      },
    };
    const verify = verifyUseCase(harness, { passwordHasher: slowHasher });
    const racing = verify.execute({ challengeToken: challenge, code: recoveryCodes[0] ?? '' });
    await checking.promise;

    const disabling = request(harness.app)
      .post('/auth/2fa/disable')
      .set(trustedHeaders)
      .set('Cookie', cookieHeader(cookies))
      .send({ code: totpNow(secret, harness.clock) })
      .then((response) => response);
    await untilSomeoneWaitsForALock();
    release.open();
    const [result, disabled] = await Promise.all([racing, disabling]);

    expect(result.outcome).toBe('signed_in');
    expect(disabled.status).toBe(204);
    if (result.outcome !== 'signed_in') return;
    // The disable committed after the verify and bumped the version: that session is dead too.
    const session = {
      accessToken: result.session.accessToken,
      refreshToken: result.session.refreshToken,
    };
    expect((await currentSession(harness.app, session)).status).toBe(401);
    expect(await count('select count(*) as n from user_two_factor')).toBe(0);
    expect(await count('select count(*) as n from recovery_codes')).toBe(0);
    expect(await count('select count(*) as n from sign_in_challenges')).toBe(0);
  }, 30_000);
});

describe('VerifySecondFactor faults (sad path)', () => {
  it('a unit-of-work fault gives the NFR-04 units back and is rethrown', async () => {
    const harness = harnessOn(connection);
    const userId = await seedUser(connection, { email: 'ana@example.com', password: PASSWORD });
    const { secret } = await seedTwoFactor(connection, userId, harness.clock);
    const challenge = await firstFactor(harness, 'ana@example.com');
    const fault = new Error('database down');
    const refundFailures: unknown[] = [];
    const verify = verifyUseCase(harness, {
      unitOfWork: { run: () => Promise.reject(fault) },
      refundFailures,
    });

    await expect(
      verify.execute({ challengeToken: challenge, code: totpNow(secret, harness.clock) }),
    ).rejects.toBe(fault);

    expect(await secondFactorUnits(userId)).toBe(0);
    expect(refundFailures).toEqual([]);
    expect(await sessionCount()).toBe(0);
    expect(await lastUsedStep(userId)).toBe(0);
  });
});
