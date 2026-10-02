import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createIdentityInfrastructure,
  Email,
  type IdentityDb,
  type TransactionalRepositories,
  type UserCreatedHook,
} from '../../src/identity';
import { DrizzleOAuthStateRepository } from '../../src/identity/infrastructure/db/drizzle-oauth-state-repository';
import { DrizzleOneTimeTokenRepository } from '../../src/identity/infrastructure/db/drizzle-one-time-token-repository';
import { DrizzleProfileRepository } from '../../src/identity/infrastructure/db/drizzle-profile-repository';
import { DrizzleRecoveryCodeRepository } from '../../src/identity/infrastructure/db/drizzle-recovery-code-repository';
import { DrizzleSessionRepository } from '../../src/identity/infrastructure/db/drizzle-session-repository';
import { DrizzleSignInChallengeRepository } from '../../src/identity/infrastructure/db/drizzle-sign-in-challenge-repository';
import { DrizzleTwoFactorRepository } from '../../src/identity/infrastructure/db/drizzle-two-factor-repository';
import { DrizzleUnitOfWork } from '../../src/identity/infrastructure/db/drizzle-unit-of-work';
import { DrizzleUserIdentityRepository } from '../../src/identity/infrastructure/db/drizzle-user-identity-repository';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { PostgresAttemptLimiter } from '../../src/identity/infrastructure/db/postgres-attempt-limiter';
import {
  AesGcmSecretBox,
  UnavailableSecretBox,
} from '../../src/identity/infrastructure/security/aes-gcm-secret-box';
import { Argon2idPasswordHasher } from '../../src/identity/infrastructure/security/argon2id-password-hasher';
import { CryptoRecoveryCodeGenerator } from '../../src/identity/infrastructure/security/crypto-recovery-code-generator';
import { CryptoTokenGenerator } from '../../src/identity/infrastructure/security/crypto-token-generator';
import { FakeBreachedPasswordChecker } from '../../src/identity/infrastructure/security/fake-breached-password-checker';
import { HibpBreachedPasswordChecker } from '../../src/identity/infrastructure/security/hibp-breached-password-checker';
import { RfcTotpEngine } from '../../src/identity/infrastructure/security/totp';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { testDatabaseUrl } from '../helpers/test-database';
import { TEST_TOTP_ENCRYPTION_KEY } from '../helpers/test-env';

let connection: DatabaseConnection;
const logger = createLogger({ level: 'silent' });

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

describe('createIdentityInfrastructure', () => {
  it('wires the PostgreSQL and security adapters', () => {
    const identity = createIdentityInfrastructure({
      db: connection.db,
      env: { BREACH_CHECKER: 'hibp', TOTP_ENCRYPTION_KEY: TEST_TOTP_ENCRYPTION_KEY },
      logger,
    });

    expect(identity.users).toBeInstanceOf(DrizzleUserRepository);
    expect(identity.profiles).toBeInstanceOf(DrizzleProfileRepository);
    expect(identity.sessions).toBeInstanceOf(DrizzleSessionRepository);
    expect(identity.oneTimeTokens).toBeInstanceOf(DrizzleOneTimeTokenRepository);
    expect(identity.identities).toBeInstanceOf(DrizzleUserIdentityRepository);
    expect(identity.oauthStates).toBeInstanceOf(DrizzleOAuthStateRepository);
    expect(identity.oauthStatePurger).toBeInstanceOf(DrizzleOAuthStateRepository);
    expect(identity.attemptLimiter).toBeInstanceOf(PostgresAttemptLimiter);
    expect(identity.passwordHasher).toBeInstanceOf(Argon2idPasswordHasher);
    expect(identity.tokenGenerator).toBeInstanceOf(CryptoTokenGenerator);
    expect(identity.breachedPasswordChecker).toBeInstanceOf(HibpBreachedPasswordChecker);
    expect(identity.clock.now()).toBeInstanceOf(Date);
    expect(identity.twoFactor).toBeInstanceOf(DrizzleTwoFactorRepository);
    expect(identity.recoveryCodes).toBeInstanceOf(DrizzleRecoveryCodeRepository);
    expect(identity.signInChallenges).toBeInstanceOf(DrizzleSignInChallengeRepository);
    expect(identity.signInChallengePurger).toBeInstanceOf(DrizzleSignInChallengeRepository);
    expect(identity.totp).toBeInstanceOf(RfcTotpEngine);
    expect(identity.secretBox).toBeInstanceOf(AesGcmSecretBox);
    expect(identity.recoveryCodeGenerator).toBeInstanceOf(CryptoRecoveryCodeGenerator);
  });

  it('selects the fake breach checker when BREACH_CHECKER=fake', () => {
    const identity = createIdentityInfrastructure({
      db: connection.db,
      env: { BREACH_CHECKER: 'fake', TOTP_ENCRYPTION_KEY: TEST_TOTP_ENCRYPTION_KEY },
      logger,
    });

    expect(identity.breachedPasswordChecker).toBeInstanceOf(FakeBreachedPasswordChecker);
  });

  it('makes the secret box unavailable when TOTP_ENCRYPTION_KEY is unset (outside production)', () => {
    const identity = createIdentityInfrastructure({
      db: connection.db,
      env: { BREACH_CHECKER: 'fake', TOTP_ENCRYPTION_KEY: undefined },
      logger,
    });

    expect(identity.secretBox).toBeInstanceOf(UnavailableSecretBox);
  });

  it('uses the injected clock', () => {
    const fixed = new Date('2026-01-01T00:00:00.000Z');
    const identity = createIdentityInfrastructure({
      db: connection.db,
      env: { BREACH_CHECKER: 'fake', TOTP_ENCRYPTION_KEY: TEST_TOTP_ENCRYPTION_KEY },
      logger,
      clock: { now: () => fixed },
    });

    expect(identity.clock.now()).toBe(fixed);
  });
});

describe('DrizzleUnitOfWork user-created hooks', () => {
  const clock = { now: () => new Date('2026-01-01T00:00:00.000Z') };

  async function createUser(
    repositories: TransactionalRepositories,
    email = 'ana@example.com',
  ): Promise<string> {
    const user = await repositories.users.create({
      email: Email.parse(email),
      passwordHash: null,
      defaultRateType: 'mep',
      displayCurrency: 'ARS',
      timeZone: 'UTC',
      language: 'es',
    });
    return user.id;
  }

  async function userCount(): Promise<number> {
    const result = await connection.pool.query<{ n: string }>('select count(*) as n from users');
    return Number(result.rows[0]?.n);
  }

  it('calls every hook, in order, with the transaction handle and the new user id (FR-01)', async () => {
    const calls: { name: string; tx: IdentityDb; userId: string }[] = [];
    const hook = (name: string): UserCreatedHook => {
      return (tx, userId) => {
        calls.push({ name, tx, userId });
        return Promise.resolve();
      };
    };
    const unitOfWork = new DrizzleUnitOfWork(connection.db, clock, [hook('first'), hook('second')]);

    const userId = await unitOfWork.run(async (repositories) => {
      const id = await createUser(repositories);
      await repositories.provisioning.provision(id);
      return id;
    });

    expect(calls.map((call) => [call.name, call.userId])).toEqual([
      ['first', userId],
      ['second', userId],
    ]);
    const [first, second] = calls;
    expect(first?.tx).toBe(second?.tx);
    expect(first?.tx).not.toBe(connection.db);
  });

  it('lets a hook write through the transaction handle, committed with the user', async () => {
    const unitOfWork = new DrizzleUnitOfWork(connection.db, clock, [
      async (tx, userId) => {
        await tx.execute(
          sql`insert into category_defaults_seeded (owner_id) values (${userId}::uuid)`,
        );
      },
    ]);

    const userId = await unitOfWork.run(async (repositories) => {
      const id = await createUser(repositories);
      await repositories.provisioning.provision(id);
      return id;
    });

    const marker = await connection.pool.query(
      'select 1 from category_defaults_seeded where owner_id = $1',
      [userId],
    );
    expect(marker.rowCount).toBe(1);
  });

  it('rolls the user back when a hook rejects, and skips the hooks after it (AC-19)', async () => {
    const fault = new Error('seeding failed');
    const after = vi.fn(() => Promise.resolve());
    const unitOfWork = new DrizzleUnitOfWork(connection.db, clock, [
      () => Promise.reject(fault),
      after,
    ]);

    await expect(
      unitOfWork.run(async (repositories) => {
        const id = await createUser(repositories);
        await repositories.provisioning.provision(id);
      }),
    ).rejects.toMatchObject({ name: 'NewUserProvisioningFailed', cause: fault });

    expect(await userCount()).toBe(0);
    expect(after).not.toHaveBeenCalled();
  });

  it('rejects with a distinct error type that keeps the original as its cause', async () => {
    const fault = new Error('seeding failed');
    const unitOfWork = new DrizzleUnitOfWork(connection.db, clock, [() => Promise.reject(fault)]);

    const error: unknown = await unitOfWork
      .run(async (repositories) => {
        const id = await createUser(repositories);
        await repositories.provisioning.provision(id);
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).constructor.name).toBe('NewUserProvisioningFailed');
    expect((error as Error).cause).toBe(fault);
    expect((error as Error).message).not.toContain('seeding failed');
  });

  it('provisions nothing and succeeds when no hook is registered (default)', async () => {
    const unitOfWork = new DrizzleUnitOfWork(connection.db, clock);

    await unitOfWork.run(async (repositories) => {
      const id = await createUser(repositories);
      await repositories.provisioning.provision(id);
    });

    expect(await userCount()).toBe(1);
  });

  it('createIdentityInfrastructure hands onUserCreated to its unit of work', async () => {
    const seen: string[] = [];
    const identity = createIdentityInfrastructure({
      db: connection.db,
      env: { BREACH_CHECKER: 'fake', TOTP_ENCRYPTION_KEY: TEST_TOTP_ENCRYPTION_KEY },
      logger,
      onUserCreated: [
        (_tx, userId) => {
          seen.push(userId);
          return Promise.resolve();
        },
      ],
    });

    const userId = await identity.unitOfWork.run(async (repositories) => {
      const id = await createUser(repositories);
      await repositories.provisioning.provision(id);
      return id;
    });

    expect(seen).toEqual([userId]);
  });
});
