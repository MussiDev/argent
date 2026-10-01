import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIdentityInfrastructure } from '../../src/identity';
import type { PasswordHasher } from '../../src/identity/application/ports/password-hasher';
import type { UnitOfWork } from '../../src/identity/application/ports/unit-of-work';
import { RefreshSession } from '../../src/identity/application/refresh-session';
import { CreateSignInChallenge } from '../../src/identity/application/create-sign-in-challenge';
import { SignIn } from '../../src/identity/application/sign-in';
import { StartSession } from '../../src/identity/application/start-session';
import { DUMMY_PASSWORD_HASH } from '../../src/identity/infrastructure/security/argon2id-password-hasher';
import { JoseAccessTokenIssuer } from '../../src/identity/infrastructure/security/jose-access-token-issuer';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness, type IdentityHarness } from '../helpers/identity-harness';
import {
  currentSession,
  refresh,
  seedUser,
  sessionFrom,
  signIn,
  signOut,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { TEST_TOTP_ENCRYPTION_KEY, testEnv, trustedHeaders } from '../helpers/test-env';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const EMAIL = 'ana@example.com';
const PASSWORD = 'a long enough passphrase';
const NEW_PASSWORD = 'a brand new passphrase';

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

/** The identity adapters on the test database, sharing the harness clock and JWT secret. */
function adaptersFor(harness: IdentityHarness) {
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
  return { infrastructure, accessTokens };
}

/** Requests a reset over HTTP, lets the worker send it and returns the token from the email. */
async function resetToken(harness: IdentityHarness): Promise<string> {
  const requested = await request(harness.app)
    .post('/auth/password-reset/request')
    .set(trustedHeaders)
    .send({ email: EMAIL });
  expect(requested.status).toBe(202);
  await harness.worker.runOnce();
  return harness.transport.lastTokenFor(EMAIL);
}

function confirmReset(harness: IdentityHarness, token: string) {
  return request(harness.app)
    .post('/auth/password-reset/confirm')
    .set(trustedHeaders)
    .send({ token, newPassword: NEW_PASSWORD });
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

describe('credentials version (AC-10)', () => {
  it("rejects a session whose credentials version is older than its user's, on use and on refresh", async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = sessionFrom(await signIn(harness.app, EMAIL, PASSWORD));
    expect((await currentSession(harness.app, cookies)).status).toBe(200);

    await connection.pool.query('update users set credentials_version = credentials_version + 1');

    expect((await currentSession(harness.app, cookies)).status).toBe(401);
    expect((await refresh(harness.app, cookies)).status).toBe(401);
  });

  it('kills a session whose sign-in read the old password hash before a reset committed', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const token = await resetToken(harness);
    const { infrastructure, accessTokens } = adaptersFor(harness);
    const hashing = latch();
    const release = latch();
    // Slow hasher: the sign-in has read the user (and its old hash) and now waits mid-hash.
    const slowHasher: PasswordHasher = {
      hash: (password) => infrastructure.passwordHasher.hash(password),
      verify: async (passwordHash, password) => {
        const matches = await infrastructure.passwordHasher.verify(passwordHash, password);
        hashing.open();
        await release.promise;
        return matches;
      },
    };
    const signInUseCase = new SignIn({
      attemptLimiter: infrastructure.attemptLimiter,
      users: infrastructure.users,
      passwordHasher: slowHasher,
      dummyPasswordHash: DUMMY_PASSWORD_HASH,
      startSession: new StartSession({
        sessions: infrastructure.sessions,
        tokenGenerator: infrastructure.tokenGenerator,
        accessTokens,
        clock: harness.clock,
      }),
      twoFactor: infrastructure.twoFactor,
      createSignInChallenge: new CreateSignInChallenge({
        signInChallenges: infrastructure.signInChallenges,
        tokenGenerator: infrastructure.tokenGenerator,
        clock: harness.clock,
      }),
      reportRefundFailure: () => undefined,
    });

    const racing = signInUseCase.execute({ email: EMAIL, password: PASSWORD, ip: '203.0.113.5' });
    await hashing.promise;
    expect((await confirmReset(harness, token)).status).toBe(200);
    release.open();
    const result = await racing;

    // The old password matched the hash read before the reset, so a session row was created...
    if (result.outcome !== 'signed_in')
      throw new Error(`expected a session, got ${result.outcome}`);
    // ...but it is dead on first use.
    const cookies = {
      accessToken: result.session.accessToken,
      refreshToken: result.session.refreshToken,
    };
    expect((await currentSession(harness.app, cookies)).status).toBe(401);
    expect((await refresh(harness.app, cookies)).status).toBe(401);
    expect((await signIn(harness.app, EMAIL, NEW_PASSWORD)).status).toBe(200);
  });

  it('kills the successor of a refresh that commits while a reset waits to revoke the sessions', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = sessionFrom(await signIn(harness.app, EMAIL, PASSWORD));
    const token = await resetToken(harness);
    const { infrastructure, accessTokens } = adaptersFor(harness);
    const rotated = latch();
    const release = latch();
    // Holds the rotation transaction open after it inserted the successor and claimed the old row.
    const slowCommit: UnitOfWork = {
      run: (work) =>
        infrastructure.unitOfWork.run(async (repositories) => {
          const result = await work(repositories);
          rotated.open();
          await release.promise;
          return result;
        }),
    };
    const refreshSession = new RefreshSession({
      sessions: infrastructure.sessions,
      users: infrastructure.users,
      tokenGenerator: infrastructure.tokenGenerator,
      accessTokens,
      unitOfWork: slowCommit,
      clock: harness.clock,
    });

    const racing = refreshSession.execute(cookies.refreshToken);
    await rotated.promise;
    // The reset blocks on the old session's row lock; the uncommitted successor is invisible to it.
    const confirming = confirmReset(harness, token).then((response) => response);
    await untilSomeoneWaitsForALock();
    release.open();
    const [refreshed, confirmed] = await Promise.all([racing, confirming]);

    expect(confirmed.status).toBe(200);
    if (refreshed.outcome !== 'rotated') {
      throw new Error(`expected rotation, got ${refreshed.outcome}`);
    }
    const successor = {
      accessToken: refreshed.session.accessToken,
      refreshToken: refreshed.session.refreshToken,
    };
    expect((await currentSession(harness.app, successor)).status).toBe(401);
    expect((await refresh(harness.app, successor)).status).toBe(401);
  });
});

describe('refresh racing a sign-out (FIX-001)', () => {
  it('rejects (401) a refresh whose claim loses to a sign-out, without treating it as reuse', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = sessionFrom(await signIn(harness.app, EMAIL, PASSWORD));
    const { infrastructure, accessTokens } = adaptersFor(harness);
    const claiming = latch();
    const release = latch();
    // Holds the refresh after it read the live session and before its rotation transaction starts.
    const lateClaim: UnitOfWork = {
      run: async (work) => {
        claiming.open();
        await release.promise;
        return infrastructure.unitOfWork.run(work);
      },
    };
    const refreshSession = new RefreshSession({
      sessions: infrastructure.sessions,
      users: infrastructure.users,
      tokenGenerator: infrastructure.tokenGenerator,
      accessTokens,
      unitOfWork: lateClaim,
      clock: harness.clock,
    });

    const racing = refreshSession.execute(cookies.refreshToken);
    await claiming.promise;
    expect((await signOut(harness.app, cookies)).status).toBe(204);
    release.open();

    expect(await racing).toEqual({ outcome: 'rejected' });
    // The lost claim rolled back its successor; only the signed-out session remains.
    const rows = await connection.pool.query<{ replaced_by: string | null }>(
      'select replaced_by from sessions',
    );
    expect(rows.rows).toEqual([{ replaced_by: null }]);
  });
});
