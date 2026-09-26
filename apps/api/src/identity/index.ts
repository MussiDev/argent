import type { Env } from '../shared/config/env';
import type { Logger } from '../shared/logging/logger';
import type { AttemptLimiter } from './application/ports/attempt-limiter';
import type { BreachedPasswordChecker } from './application/ports/breached-password-checker';
import { systemClock, type Clock } from './application/ports/clock';
import type { OneTimeTokenRepository } from './application/ports/one-time-token-repository';
import type { PasswordHasher } from './application/ports/password-hasher';
import type { SessionRepository } from './application/ports/session-repository';
import type { TokenGenerator } from './application/ports/token-generator';
import type { UserRepository } from './application/ports/user-repository';
import { DrizzleOneTimeTokenRepository } from './infrastructure/db/drizzle-one-time-token-repository';
import { DrizzleSessionRepository } from './infrastructure/db/drizzle-session-repository';
import { DrizzleUserRepository } from './infrastructure/db/drizzle-user-repository';
import { PostgresAttemptLimiter } from './infrastructure/db/postgres-attempt-limiter';
import type { IdentityDb } from './infrastructure/db/schema';
import { Argon2idPasswordHasher } from './infrastructure/security/argon2id-password-hasher';
import { CryptoTokenGenerator } from './infrastructure/security/crypto-token-generator';
import { FakeBreachedPasswordChecker } from './infrastructure/security/fake-breached-password-checker';
import { HibpBreachedPasswordChecker } from './infrastructure/security/hibp-breached-password-checker';

export * from './domain/account-defaults';
export * from './domain/email';
export * from './domain/errors';
export * from './domain/password-rules';
export * from './application/ports/attempt-limiter';
export * from './application/ports/breached-password-checker';
export * from './application/ports/clock';
export * from './application/ports/email-sender';
export * from './application/ports/one-time-token-repository';
export * from './application/ports/password-hasher';
export * from './application/ports/session-repository';
export * from './application/ports/token-generator';
export * from './application/ports/user-repository';
export type { IdentityDb } from './infrastructure/db/schema';

export interface IdentityInfrastructureDependencies {
  /** The application database; a transaction is accepted too. */
  db: IdentityDb;
  env: Pick<Env, 'BREACH_CHECKER'>;
  logger: Logger;
  clock?: Clock;
}

export interface IdentityInfrastructure {
  clock: Clock;
  users: UserRepository;
  sessions: SessionRepository;
  oneTimeTokens: OneTimeTokenRepository;
  attemptLimiter: AttemptLimiter;
  passwordHasher: PasswordHasher;
  breachedPasswordChecker: BreachedPasswordChecker;
  tokenGenerator: TokenGenerator;
}

/** Composition root of the identity module's adapters. */
export function createIdentityInfrastructure({
  db,
  env,
  logger,
  clock = systemClock,
}: IdentityInfrastructureDependencies): IdentityInfrastructure {
  return {
    clock,
    users: new DrizzleUserRepository(db),
    sessions: new DrizzleSessionRepository(db),
    oneTimeTokens: new DrizzleOneTimeTokenRepository(db),
    attemptLimiter: new PostgresAttemptLimiter(db, clock),
    passwordHasher: new Argon2idPasswordHasher(),
    breachedPasswordChecker:
      env.BREACH_CHECKER === 'fake'
        ? new FakeBreachedPasswordChecker()
        : new HibpBreachedPasswordChecker({ logger }),
    tokenGenerator: new CryptoTokenGenerator(),
  };
}
