import type { RequestHandler, Router } from 'express';
import type { Env } from '../shared/config/env';
import { createRequireSession } from '../shared/http/require-session';
import type { Logger } from '../shared/logging/logger';
import { CompleteGoogleSignIn } from './application/complete-google-sign-in';
import { ConfirmPasswordReset } from './application/confirm-password-reset';
import { GetCurrentSession } from './application/get-current-session';
import { RefreshSession } from './application/refresh-session';
import { RegisterUser } from './application/register-user';
import { RequestPasswordReset } from './application/request-password-reset';
import { ResendVerification } from './application/resend-verification';
import { SignIn } from './application/sign-in';
import { SignOut } from './application/sign-out';
import { SignOutAll } from './application/sign-out-all';
import { StartGoogleSignIn } from './application/start-google-sign-in';
import { StartSession } from './application/start-session';
import { VerifyEmail } from './application/verify-email';
import type { AttemptLimiter } from './application/ports/attempt-limiter';
import type { AttemptPurger } from './application/ports/attempt-purger';
import type { BreachedPasswordChecker } from './application/ports/breached-password-checker';
import type { Clock } from './application/ports/clock';
import type { EmailSender } from './application/ports/email-sender';
import type { GoogleIdentityProvider } from './application/ports/google-identity-provider';
import type { OAuthStatePurger } from './application/ports/oauth-state-purger';
import type { OAuthStateRepository } from './application/ports/oauth-state-repository';
import type { OneTimeTokenRepository } from './application/ports/one-time-token-repository';
import type { PasswordHasher } from './application/ports/password-hasher';
import type { SessionRepository } from './application/ports/session-repository';
import type { TokenGenerator } from './application/ports/token-generator';
import type { UnitOfWork } from './application/ports/unit-of-work';
import type { UserIdentityRepository } from './application/ports/user-identity-repository';
import type { UserRepository } from './application/ports/user-repository';
import { DrizzleOAuthStateRepository } from './infrastructure/db/drizzle-oauth-state-repository';
import { DrizzleOneTimeTokenRepository } from './infrastructure/db/drizzle-one-time-token-repository';
import { DrizzleSessionRepository } from './infrastructure/db/drizzle-session-repository';
import { DrizzleUnitOfWork } from './infrastructure/db/drizzle-unit-of-work';
import { DrizzleUserIdentityRepository } from './infrastructure/db/drizzle-user-identity-repository';
import { DrizzleUserRepository } from './infrastructure/db/drizzle-user-repository';
import { PostgresAttemptLimiter } from './infrastructure/db/postgres-attempt-limiter';
import type { IdentityDb } from './infrastructure/db/schema';
import type { EmailTransport } from './infrastructure/email/email-transport';
import { EmailWorker } from './infrastructure/email/email-worker';
import { OutboxEmailSender } from './infrastructure/email/outbox-email-sender';
import { createGoogleRoutes } from './infrastructure/http/google-routes';
import { createPasswordResetRoutes } from './infrastructure/http/password-reset-routes';
import { createRegistrationRoutes } from './infrastructure/http/registration-routes';
import { ACCESS_TOKEN_COOKIE } from './infrastructure/http/session-cookies';
import { createSessionRoutes } from './infrastructure/http/session-routes';
import {
  Argon2idPasswordHasher,
  DUMMY_PASSWORD_HASH,
} from './infrastructure/security/argon2id-password-hasher';
import { CryptoTokenGenerator } from './infrastructure/security/crypto-token-generator';
import { FakeBreachedPasswordChecker } from './infrastructure/security/fake-breached-password-checker';
import { GoogleOidcIdentityProvider } from './infrastructure/security/google-oidc-identity-provider';
import { HibpBreachedPasswordChecker } from './infrastructure/security/hibp-breached-password-checker';
import { JoseAccessTokenIssuer } from './infrastructure/security/jose-access-token-issuer';
import { UnconfiguredGoogleIdentityProvider } from './infrastructure/security/unconfigured-google-identity-provider';
import { systemClock } from './infrastructure/system-clock';

export * from './domain/account-defaults';
export * from './domain/email';
export * from './domain/errors';
export * from './domain/password-rules';
export * from './application/ports/access-token-issuer';
export * from './application/ports/attempt-limiter';
export * from './application/ports/attempt-purger';
export * from './application/ports/breached-password-checker';
export * from './application/ports/clock';
export * from './application/ports/email-sender';
export * from './application/ports/google-identity-provider';
export * from './application/ports/oauth-state-purger';
export * from './application/ports/oauth-state-repository';
export * from './application/ports/one-time-token-repository';
export * from './application/ports/password-hasher';
export * from './application/ports/session-repository';
export * from './application/ports/token-generator';
export * from './application/ports/unit-of-work';
export * from './application/ports/user-identity-repository';
export * from './application/ports/user-repository';
export type { IdentityDb } from './infrastructure/db/schema';
export { systemClock } from './infrastructure/system-clock';
export { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './infrastructure/http/session-cookies';
export { createEmailTransport } from './infrastructure/email/email-transport';
export type { EmailTransport } from './infrastructure/email/email-transport';
export type { EmailWorker } from './infrastructure/email/email-worker';

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
  identities: UserIdentityRepository;
  oauthStates: OAuthStateRepository;
  oauthStatePurger: OAuthStatePurger;
  attemptLimiter: AttemptLimiter;
  attemptPurger: AttemptPurger;
  passwordHasher: PasswordHasher;
  breachedPasswordChecker: BreachedPasswordChecker;
  tokenGenerator: TokenGenerator;
  emailSender: EmailSender;
  unitOfWork: UnitOfWork;
}

/** Composition root of the identity module's adapters. */
export function createIdentityInfrastructure({
  db,
  env,
  logger,
  clock = systemClock,
}: IdentityInfrastructureDependencies): IdentityInfrastructure {
  const attemptLimiter = new PostgresAttemptLimiter(db, clock);
  const oauthStates = new DrizzleOAuthStateRepository(db);
  return {
    clock,
    users: new DrizzleUserRepository(db),
    sessions: new DrizzleSessionRepository(db),
    oneTimeTokens: new DrizzleOneTimeTokenRepository(db),
    identities: new DrizzleUserIdentityRepository(db),
    oauthStates,
    oauthStatePurger: oauthStates,
    attemptLimiter,
    attemptPurger: attemptLimiter,
    passwordHasher: new Argon2idPasswordHasher({ logger }),
    breachedPasswordChecker:
      env.BREACH_CHECKER === 'fake'
        ? new FakeBreachedPasswordChecker()
        : new HibpBreachedPasswordChecker({ logger }),
    tokenGenerator: new CryptoTokenGenerator(),
    emailSender: new OutboxEmailSender(db, clock),
    unitOfWork: new DrizzleUnitOfWork(db, clock),
  };
}

export interface IdentityModuleDependencies extends Omit<
  IdentityInfrastructureDependencies,
  'env'
> {
  env: Pick<
    Env,
    | 'BREACH_CHECKER'
    | 'JWT_SECRET'
    | 'API_ORIGIN'
    | 'WEB_BASE_URL'
    | 'GOOGLE_CLIENT_ID'
    | 'GOOGLE_CLIENT_SECRET'
    | 'GOOGLE_AUTHORIZATION_URL'
    | 'GOOGLE_TOKEN_URL'
    | 'GOOGLE_JWKS_URL'
    | 'GOOGLE_ISSUER'
  >;
  /**
   * Test seam: replaces the real `requireSession` on the identity module's authenticated routes.
   * It must set `req.auth`.
   */
  requireSession?: RequestHandler | undefined;
  /** Test seam: replaces the breach checker selected by `BREACH_CHECKER`. */
  breachedPasswordChecker?: BreachedPasswordChecker | undefined;
}

export interface IdentityModule {
  /** The identity module's HTTP routers, wired to their use cases and adapters. */
  routers: Router[];
  /**
   * The real session middleware (JWT + live session row + existing user), for every module's
   * authenticated routes. Sets `req.auth`; answers 401 `UNAUTHENTICATED` otherwise.
   */
  requireSession: RequestHandler;
}

/**
 * Google sign-in as configured. Built once per module: the adapter caches Google's signing keys.
 * Without a client id (only possible outside production) every Google sign-in fails.
 */
function createGoogleIdentityProvider(
  env: IdentityModuleDependencies['env'],
  tokenGenerator: TokenGenerator,
): GoogleIdentityProvider {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new UnconfiguredGoogleIdentityProvider();
  }
  return new GoogleOidcIdentityProvider({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    apiOrigin: env.API_ORIGIN,
    authorizationUrl: env.GOOGLE_AUTHORIZATION_URL,
    tokenUrl: env.GOOGLE_TOKEN_URL,
    jwksUrl: env.GOOGLE_JWKS_URL,
    issuer: env.GOOGLE_ISSUER,
    tokenGenerator,
  });
}

/** Composition root of the identity module: its routers and the shared `requireSession`. */
export function createIdentityModule({
  requireSession: requireSessionOverride,
  breachedPasswordChecker,
  env,
  ...dependencies
}: IdentityModuleDependencies): IdentityModule {
  const identity = createIdentityInfrastructure({ ...dependencies, env });
  const accessTokens = new JoseAccessTokenIssuer({ secret: env.JWT_SECRET, clock: identity.clock });
  const getCurrentSession = new GetCurrentSession({
    accessTokens,
    sessions: identity.sessions,
    users: identity.users,
    clock: identity.clock,
  });
  const requireSession = createRequireSession({
    cookieName: ACCESS_TOKEN_COOKIE,
    authenticate: async (accessToken) => {
      const current = await getCurrentSession.execute(accessToken);
      return current
        ? {
            userId: current.user.id,
            sessionId: current.sessionId,
            emailVerified: current.user.emailVerifiedAt !== null,
          }
        : null;
    },
  });
  const routeSession = requireSessionOverride ?? requireSession;
  const startSession = new StartSession({
    sessions: identity.sessions,
    tokenGenerator: identity.tokenGenerator,
    accessTokens,
    clock: identity.clock,
  });
  const google = createGoogleIdentityProvider(env, identity.tokenGenerator);

  const routers = [
    createRegistrationRoutes({
      registerUser: new RegisterUser({
        attemptLimiter: identity.attemptLimiter,
        breachedPasswordChecker: breachedPasswordChecker ?? identity.breachedPasswordChecker,
        passwordHasher: identity.passwordHasher,
        dummyPasswordHash: DUMMY_PASSWORD_HASH,
        users: identity.users,
        emailSender: identity.emailSender,
        unitOfWork: identity.unitOfWork,
      }),
      verifyEmail: new VerifyEmail({
        tokenGenerator: identity.tokenGenerator,
        clock: identity.clock,
        unitOfWork: identity.unitOfWork,
      }),
      resendVerification: new ResendVerification({
        attemptLimiter: identity.attemptLimiter,
        users: identity.users,
        emailSender: identity.emailSender,
      }),
      requireSession: routeSession,
      logger: dependencies.logger,
    }),
    createSessionRoutes({
      signIn: new SignIn({
        attemptLimiter: identity.attemptLimiter,
        users: identity.users,
        passwordHasher: identity.passwordHasher,
        dummyPasswordHash: DUMMY_PASSWORD_HASH,
        startSession,
        reportRefundFailure: (error) => {
          // `err` goes through the logger's safe serializer (no query params or row values).
          dependencies.logger.warn(
            { err: error },
            'sign-in limit refund failed; the reserved units stay counted',
          );
        },
      }),
      refreshSession: new RefreshSession({
        sessions: identity.sessions,
        users: identity.users,
        tokenGenerator: identity.tokenGenerator,
        accessTokens,
        unitOfWork: identity.unitOfWork,
        clock: identity.clock,
      }),
      signOut: new SignOut({
        sessions: identity.sessions,
        tokenGenerator: identity.tokenGenerator,
        accessTokens,
        clock: identity.clock,
      }),
      signOutAll: new SignOutAll({ sessions: identity.sessions, clock: identity.clock }),
      getCurrentSession,
      requireSession: routeSession,
      logger: dependencies.logger,
    }),
    createPasswordResetRoutes({
      requestPasswordReset: new RequestPasswordReset({
        attemptLimiter: identity.attemptLimiter,
        users: identity.users,
        emailSender: identity.emailSender,
      }),
      confirmPasswordReset: new ConfirmPasswordReset({
        tokenGenerator: identity.tokenGenerator,
        clock: identity.clock,
        breachedPasswordChecker: breachedPasswordChecker ?? identity.breachedPasswordChecker,
        passwordHasher: identity.passwordHasher,
        unitOfWork: identity.unitOfWork,
      }),
      logger: dependencies.logger,
    }),
    createGoogleRoutes({
      startGoogleSignIn: new StartGoogleSignIn({
        attemptLimiter: identity.attemptLimiter,
        oauthStates: identity.oauthStates,
        google,
        tokenGenerator: identity.tokenGenerator,
        clock: identity.clock,
      }),
      completeGoogleSignIn: new CompleteGoogleSignIn({
        oauthStates: identity.oauthStates,
        google,
        tokenGenerator: identity.tokenGenerator,
        unitOfWork: identity.unitOfWork,
        startSession,
        clock: identity.clock,
      }),
      webBaseUrl: env.WEB_BASE_URL,
      logger: dependencies.logger,
    }),
  ];
  return { routers, requireSession };
}

export interface EmailWorkerFactoryDependencies {
  /** A database (not a transaction): the worker opens one transaction per outbox row. */
  db: IdentityDb;
  env: Pick<Env, 'WEB_BASE_URL'>;
  logger: Logger;
  transport: EmailTransport;
  clock?: Clock;
  pollIntervalMs?: number;
}

/**
 * The outbox worker, with the PostgreSQL attempt and OAuth-state purgers and the crypto token
 * generator.
 */
export function createEmailWorker({
  db,
  env,
  logger,
  transport,
  clock = systemClock,
  pollIntervalMs,
}: EmailWorkerFactoryDependencies): EmailWorker {
  return new EmailWorker({
    db,
    transport,
    tokenGenerator: new CryptoTokenGenerator(),
    attemptPurger: new PostgresAttemptLimiter(db, clock),
    oauthStatePurger: new DrizzleOAuthStateRepository(db),
    clock,
    logger,
    webBaseUrl: env.WEB_BASE_URL,
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
  });
}
