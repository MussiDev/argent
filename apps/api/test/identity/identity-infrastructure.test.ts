import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIdentityInfrastructure } from '../../src/identity';
import { DrizzleOneTimeTokenRepository } from '../../src/identity/infrastructure/db/drizzle-one-time-token-repository';
import { DrizzleSessionRepository } from '../../src/identity/infrastructure/db/drizzle-session-repository';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { PostgresAttemptLimiter } from '../../src/identity/infrastructure/db/postgres-attempt-limiter';
import { Argon2idPasswordHasher } from '../../src/identity/infrastructure/security/argon2id-password-hasher';
import { CryptoTokenGenerator } from '../../src/identity/infrastructure/security/crypto-token-generator';
import { FakeBreachedPasswordChecker } from '../../src/identity/infrastructure/security/fake-breached-password-checker';
import { HibpBreachedPasswordChecker } from '../../src/identity/infrastructure/security/hibp-breached-password-checker';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { testDatabaseUrl } from '../helpers/test-database';

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
      env: { BREACH_CHECKER: 'hibp' },
      logger,
    });

    expect(identity.users).toBeInstanceOf(DrizzleUserRepository);
    expect(identity.sessions).toBeInstanceOf(DrizzleSessionRepository);
    expect(identity.oneTimeTokens).toBeInstanceOf(DrizzleOneTimeTokenRepository);
    expect(identity.attemptLimiter).toBeInstanceOf(PostgresAttemptLimiter);
    expect(identity.passwordHasher).toBeInstanceOf(Argon2idPasswordHasher);
    expect(identity.tokenGenerator).toBeInstanceOf(CryptoTokenGenerator);
    expect(identity.breachedPasswordChecker).toBeInstanceOf(HibpBreachedPasswordChecker);
    expect(identity.clock.now()).toBeInstanceOf(Date);
  });

  it('selects the fake breach checker when BREACH_CHECKER=fake', () => {
    const identity = createIdentityInfrastructure({
      db: connection.db,
      env: { BREACH_CHECKER: 'fake' },
      logger,
    });

    expect(identity.breachedPasswordChecker).toBeInstanceOf(FakeBreachedPasswordChecker);
  });

  it('uses the injected clock', () => {
    const fixed = new Date('2026-01-01T00:00:00.000Z');
    const identity = createIdentityInfrastructure({
      db: connection.db,
      env: { BREACH_CHECKER: 'fake' },
      logger,
      clock: { now: () => fixed },
    });

    expect(identity.clock.now()).toBe(fixed);
  });
});
