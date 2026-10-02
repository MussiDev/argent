import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIdentityInfrastructure } from '../../src/identity';
import {
  DeleteUser,
  type DeleteUserDependencies,
} from '../../src/identity/application/delete-user';
import type { PasswordHasher } from '../../src/identity/application/ports/password-hasher';
import type { UserRepository } from '../../src/identity/application/ports/user-repository';
import { TotpInvalid, Unauthenticated } from '../../src/identity/domain/errors';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness, type IdentityHarness } from '../helpers/identity-harness';
import {
  deleteAccount,
  refresh,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { TEST_TOTP_ENCRYPTION_KEY, trustedHeaders } from '../helpers/test-env';
import {
  challengeFrom,
  seedTwoFactor,
  totpNow,
  verifySecondFactor,
} from '../helpers/two-factor-client';

/** node-postgres' default pool size, which is what the API runs with. */
const POOL_SIZE = 10;
const PASSWORD = 'a long enough passphrase';
const EMAIL = 'ana@example.com';
const OTHER_EMAIL = 'bea@example.com';
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';

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

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(sql, params);
  return Number(result.rows[0]?.n ?? 0);
}

const userExists = async (userId: string): Promise<boolean> =>
  (await count('select count(*) as n from users where id = $1', [userId])) === 1;

interface Overrides {
  users?: UserRepository;
  passwordHasher?: PasswordHasher;
}

/** `DeleteUser` on the test database with the infrastructure's real adapters, optionally wrapped. */
function useCase(harness: IdentityHarness, overrides: Overrides = {}) {
  const infrastructure = createIdentityInfrastructure({
    db: connection.db,
    env: { BREACH_CHECKER: 'fake', TOTP_ENCRYPTION_KEY: TEST_TOTP_ENCRYPTION_KEY },
    logger: createLogger({ level: 'silent' }),
    clock: harness.clock,
  });
  const dependencies: DeleteUserDependencies = {
    users: overrides.users ?? infrastructure.users,
    twoFactor: infrastructure.twoFactor,
    recoveryCodes: infrastructure.recoveryCodes,
    totp: infrastructure.totp,
    secretBox: infrastructure.secretBox,
    passwordHasher: overrides.passwordHasher ?? infrastructure.passwordHasher,
    attemptLimiter: infrastructure.attemptLimiter,
    userDeletion: infrastructure.userDeletion,
    clock: harness.clock,
    reportRefundFailure: () => undefined,
    reportRecordFailure: () => undefined,
  };
  return { infrastructure, deleteUser: new DeleteUser(dependencies) };
}

const input = (
  userId: string,
  overrides: { password?: string; secondFactorCode?: string } = {},
) => ({
  userId,
  sessionId: SESSION_ID,
  password: overrides.password,
  secondFactorCode: overrides.secondFactorCode,
  grantToken: undefined,
  ip: '127.0.0.1',
});

describe('DeleteUser races', () => {
  it('a password reset that lands between the password check and the delete answers Unauthenticated and keeps the account (race, sad path)', async () => {
    const harness = harnessOn(connection);
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const base = useCase(harness).infrastructure;
    const resetting: PasswordHasher = {
      hash: (password) => base.passwordHasher.hash(password),
      verify: async (hash, password) => {
        const matches = await base.passwordHasher.verify(hash, password);
        // The reset commits right after the check: the credentials version moves on.
        await base.users.changePassword(
          userId,
          await base.passwordHasher.hash('another long one'),
          new Date(),
        );
        return matches;
      },
    };

    const { deleteUser } = useCase(harness, { passwordHasher: resetting });

    await expect(deleteUser.execute(input(userId, { password: PASSWORD }))).rejects.toBeInstanceOf(
      Unauthenticated,
    );
    expect(await userExists(userId)).toBe(true);
  });

  it('a 2FA enable that commits between reading the user and the 2FA settings leaves the delete refused instead of skipping the second factor (race, sad path)', async () => {
    const harness = harnessOn(connection);
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const base = useCase(harness).infrastructure;
    const enabling: UserRepository = Object.create(base.users) as UserRepository;
    enabling.findById = async (id) => {
      const user = await base.users.findById(id);
      // The enable commits right after the user was read: 2FA on and the version bumped.
      await seedTwoFactor(connection, id, harness.clock);
      await base.users.bumpCredentialsVersion(id);
      return user;
    };

    const { deleteUser } = useCase(harness, { users: enabling });

    await expect(deleteUser.execute(input(userId, { password: PASSWORD }))).rejects.toBeInstanceOf(
      TotpInvalid,
    );
    expect(await userExists(userId)).toBe(true);
  });

  it('two parallel delete requests with the right password delete the account once and the second answers 401 (race)', async () => {
    const harness = harnessOn(connection);
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = sessionFrom(await signIn(harness.app, EMAIL, PASSWORD));

    const responses = await Promise.all([
      deleteAccount(harness.app, cookies, { body: { password: PASSWORD } }),
      deleteAccount(harness.app, cookies, { body: { password: PASSWORD } }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([204, 401]);
    expect(await userExists(userId)).toBe(false);
  });

  it('concurrent refreshes, second-factor verifications and deletions on a pool smaller than the calls all end as success or 401, with no deadlock or 500 (race)', async () => {
    const pooled = createDatabase(testDatabaseUrl);
    try {
      expect(pooled.pool.options.max).toBe(POOL_SIZE);
      const harness = harnessOn(pooled);
      // Two users, so the sign-in counters of one never meet the failed codes of the other: the
      // rate limiter cannot answer 429 and hide the outcome under test. Each user's calls reserve
      // at most 4 of the 5 units its account allows.
      const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
      const cookies: SessionCookies = sessionFrom(await signIn(harness.app, EMAIL, PASSWORD));
      const { recoveryCodes } = await seedTwoFactor(connection, userId, harness.clock);
      const otherId = await seedUser(connection, { email: OTHER_EMAIL, password: PASSWORD });
      const otherCookies = sessionFrom(await signIn(harness.app, OTHER_EMAIL, PASSWORD));
      const other = await seedTwoFactor(connection, otherId, harness.clock);
      const challenge = challengeFrom(await signIn(harness.app, OTHER_EMAIL, PASSWORD));
      const code = totpNow(other.secret, harness.clock);

      const refreshes = [0, 1, 2, 3].map(() => refresh(harness.app, cookies));
      const verifies = [0, 1, 2].map(() => verifySecondFactor(harness.app, challenge, code));
      const deletes = [0, 1, 2, 3].map((n) =>
        deleteAccount(harness.app, cookies, {
          body: { password: PASSWORD, secondFactorCode: recoveryCodes[n] ?? '' },
        }),
      );
      const deleteOther = deleteAccount(harness.app, otherCookies, {
        body: { password: PASSWORD, secondFactorCode: other.recoveryCodes[0] ?? '' },
      });
      const all = await Promise.all([...refreshes, ...verifies, ...deletes, deleteOther]);
      expect(all).toHaveLength(POOL_SIZE + 2);

      const [refreshed, verified, deleted, deletedOther] = [
        all.slice(0, 4),
        all.slice(4, 7),
        all.slice(7, 11),
        all.slice(11),
      ] as request.Response[][];
      for (const response of refreshed ?? []) expect([200, 401]).toContain(response.status);
      for (const response of verified ?? []) expect([200, 401]).toContain(response.status);
      for (const response of [...(deleted ?? []), ...(deletedOther ?? [])]) {
        expect([204, 401]).toContain(response.status);
      }
      expect((deleted ?? []).filter((response) => response.status === 204)).toHaveLength(1);
      expect(await userExists(userId)).toBe(false);
      expect(await count('select count(*) as n from sessions where user_id = $1', [userId])).toBe(
        0,
      );
    } finally {
      await pooled.pool.end();
    }
  }, 60_000);
});

describe('the email outbox of a deleted user', () => {
  it('has no pending rows left and the worker sends nothing to the address (AC-01)', async () => {
    const harness = harnessOn(connection);
    const registered = await request(harness.app)
      .post('/auth/register')
      .set(trustedHeaders)
      .send({ email: EMAIL, password: PASSWORD, displayName: 'Ana' });
    expect(registered.status).toBe(202);
    // The verification email is still pending: the worker has not run.
    expect(await count('select count(*) as n from email_outbox where to_email = $1', [EMAIL])).toBe(
      1,
    );
    // An unverified user can sign in and delete the account.
    const cookies = sessionFrom(await signIn(harness.app, EMAIL, PASSWORD));

    const response = await deleteAccount(harness.app, cookies, { body: { password: PASSWORD } });
    await harness.worker.runOnce();

    expect(response.status).toBe(204);
    expect(await count('select count(*) as n from email_outbox where to_email = $1', [EMAIL])).toBe(
      0,
    );
    expect(harness.transport.sent).toEqual([]);
  });
});
