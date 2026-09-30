import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIdentityInfrastructure } from '../../src/identity';
import { DrizzleOAuthStateRepository } from '../../src/identity/infrastructure/db/drizzle-oauth-state-repository';
import { DrizzleOneTimeTokenRepository } from '../../src/identity/infrastructure/db/drizzle-one-time-token-repository';
import { DrizzleRecoveryCodeRepository } from '../../src/identity/infrastructure/db/drizzle-recovery-code-repository';
import { DrizzleSessionRepository } from '../../src/identity/infrastructure/db/drizzle-session-repository';
import { DrizzleSignInChallengeRepository } from '../../src/identity/infrastructure/db/drizzle-sign-in-challenge-repository';
import { DrizzleTwoFactorRepository } from '../../src/identity/infrastructure/db/drizzle-two-factor-repository';
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
