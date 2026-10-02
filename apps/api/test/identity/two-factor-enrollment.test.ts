import cookieParser from 'cookie-parser';
import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIdentityInfrastructure, type IdentityInfrastructure } from '../../src/identity';
import { CompleteDeletionReauth } from '../../src/identity/application/complete-deletion-reauth';
import { CompleteGoogleSignIn } from '../../src/identity/application/complete-google-sign-in';
import { CreateSignInChallenge } from '../../src/identity/application/create-sign-in-challenge';
import { DisableTwoFactor } from '../../src/identity/application/disable-two-factor';
import { EnableTwoFactor } from '../../src/identity/application/enable-two-factor';
import { GetTwoFactorStatus } from '../../src/identity/application/get-two-factor-status';
import type { AttemptLimiter } from '../../src/identity/application/ports/attempt-limiter';
import type { PasswordHasher } from '../../src/identity/application/ports/password-hasher';
import type { RecoveryCodeGenerator } from '../../src/identity/application/ports/recovery-code-generator';
import type { TwoFactorRepository } from '../../src/identity/application/ports/two-factor-repository';
import type { UnitOfWork } from '../../src/identity/application/ports/unit-of-work';
import { SignIn } from '../../src/identity/application/sign-in';
import { StartSession } from '../../src/identity/application/start-session';
import { StartTwoFactorSetup } from '../../src/identity/application/start-two-factor-setup';
import { VerifySecondFactor } from '../../src/identity/application/verify-second-factor';
import { createTwoFactorRoutes } from '../../src/identity/infrastructure/http/two-factor-routes';
import { DUMMY_PASSWORD_HASH } from '../../src/identity/infrastructure/security/argon2id-password-hasher';
import { JoseAccessTokenIssuer } from '../../src/identity/infrastructure/security/jose-access-token-issuer';
import { hotp } from '../../src/identity/infrastructure/security/totp';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createErrorHandler } from '../../src/shared/http/error-handler';
import { createLogger } from '../../src/shared/logging/logger';
import type { MutableClock } from '../fakes/mutable-clock';
import { createIdentityHarness, type IdentityHarness } from '../helpers/identity-harness';
import {
  cookieHeader,
  currentSession,
  parseSetCookies,
  refresh,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
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
const STEP_MS = 30_000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const DISPLAY_CODE = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

// --- HTTP helpers -------------------------------------------------------------------------------

function status(app: Express, cookies: Partial<SessionCookies>) {
  return request(app).get('/auth/2fa').set('Cookie', cookieHeader(cookies));
}

function setup(app: Express, cookies: Partial<SessionCookies>) {
  return request(app)
    .post('/auth/2fa/setup')
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(cookies))
    .send({});
}

function enable(app: Express, cookies: Partial<SessionCookies>, code: unknown) {
  return request(app)
    .post('/auth/2fa/enable')
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(cookies))
    .send({ code });
}

function disable(app: Express, cookies: Partial<SessionCookies>, code: unknown) {
  return request(app)
    .post('/auth/2fa/disable')
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(cookies))
    .send({ code });
}

// --- TOTP helpers -------------------------------------------------------------------------------

function stepAt(clock: MutableClock): number {
  return Math.floor(clock.now().getTime() / STEP_MS);
}

function totpNow(secret: string, clock: MutableClock): string {
  return hotp(secret, stepAt(clock));
}

/** A 6-digit code that matches none of the steps the engine accepts right now. */
function wrongCode(secret: string, clock: MutableClock): string {
  const step = stepAt(clock);
  const valid = new Set([step - 1, step, step + 1].map((s) => hotp(secret, s)));
  for (let n = 0; ; n += 1) {
    const candidate = String(n).padStart(6, '0');
    if (!valid.has(candidate)) return candidate;
  }
}

// --- Fixtures -----------------------------------------------------------------------------------

async function signedIn(harness: IdentityHarness, email = EMAIL): Promise<SessionCookies> {
  const response = await signIn(harness.app, email, PASSWORD);
  expect(response.status).toBe(200);
  return sessionFrom(response);
}

async function startedSetup(
  harness: IdentityHarness,
  cookies: SessionCookies,
): Promise<{ secret: string; otpauthUri: string }> {
  const response = await setup(harness.app, cookies);
  expect(response.status).toBe(200);
  return response.body as { secret: string; otpauthUri: string };
}

interface Enrolled {
  userId: string;
  cookies: SessionCookies;
  secret: string;
  recoveryCodes: string[];
  /** The TOTP code the enable was confirmed with. */
  enableCode: string;
}

/** A verified user with 2FA enabled, signed in with the session the enable re-issued. */
async function enrolled(
  harness: IdentityHarness,
  options: { email?: string; language?: 'es' | 'en' } = {},
): Promise<Enrolled> {
  const email = options.email ?? EMAIL;
  const userId = await seedUser(connection, {
    email,
    password: PASSWORD,
    ...(options.language ? { language: options.language } : {}),
  });
  const before = await signedIn(harness, email);
  const { secret } = await startedSetup(harness, before);
  const enableCode = totpNow(secret, harness.clock);
  const response = await enable(harness.app, before, enableCode);
  expect(response.status).toBe(200);
  const { recoveryCodes } = response.body as { recoveryCodes: string[] };
  // The enable's step is used: later codes need a later step.
  harness.clock.advance(STEP_MS);
  return { userId, cookies: sessionFrom(response), secret, recoveryCodes, enableCode };
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(sql, params);
  return Number(result.rows[0]?.n ?? 0);
}

async function attempts(kind: string, key?: string): Promise<number> {
  return key === undefined
    ? count('select coalesce(sum(count), 0) as n from auth_attempts where kind = $1', [kind])
    : count('select coalesce(sum(count), 0) as n from auth_attempts where kind = $1 and key = $2', [
        kind,
        key,
      ]);
}

async function twoFactorEnabled(userId: string): Promise<boolean> {
  return (
    (await count(
      'select count(*) as n from user_two_factor where user_id = $1 and enabled_at is not null',
      [userId],
    )) === 1
  );
}

async function credentialsVersion(userId: string): Promise<number> {
  return count('select credentials_version as n from users where id = $1', [userId]);
}

async function disableUnits(): Promise<number> {
  return (
    (await attempts('two_factor_disable_user')) + (await attempts('two_factor_disable_user_24h'))
  );
}

/** A two-factor repository that runs `before` once, ahead of its first `advanceLastUsedStep`. */
function beforeFirstStep(
  real: TwoFactorRepository,
  before: () => Promise<void>,
): TwoFactorRepository {
  let fired = false;
  return {
    findByUserId: (id) => real.findByUserId(id),
    savePending: (id, sealed) => real.savePending(id, sealed),
    activate: (id, sealed, at) => real.activate(id, sealed, at),
    delete: (id) => real.delete(id),
    advanceLastUsedStep: async (id, step) => {
      if (!fired) {
        fired = true;
        await before();
      }
      return real.advanceLastUsedStep(id, step);
    },
  };
}

/** `real` with its `findByUserId` replaced. */
function withFindByUserId(
  real: TwoFactorRepository,
  findByUserId: TwoFactorRepository['findByUserId'],
): TwoFactorRepository {
  return {
    findByUserId,
    savePending: (id, sealed) => real.savePending(id, sealed),
    activate: (id, sealed, at) => real.activate(id, sealed, at),
    advanceLastUsedStep: (id, step) => real.advanceLastUsedStep(id, step),
    delete: (id) => real.delete(id),
  };
}

/** What a concurrent disable that committed first leaves behind. */
async function removeTwoFactorElsewhere(): Promise<void> {
  await connection.pool.query('delete from recovery_codes');
  await connection.pool.query('delete from user_two_factor');
}

async function outboxKinds(): Promise<string[]> {
  const result = await connection.pool.query<{ kind: string }>(
    'select kind from email_outbox order by created_at, kind',
  );
  return result.rows.map((row) => row.kind);
}

/** The identity adapters on the test database, sharing the harness clock and JWT secret. */
function adaptersFor(harness: IdentityHarness, key: string | undefined = TEST_TOTP_ENCRYPTION_KEY) {
  const infrastructure = createIdentityInfrastructure({
    db: connection.db,
    env: { BREACH_CHECKER: 'fake', TOTP_ENCRYPTION_KEY: key },
    logger: createLogger({ level: 'silent' }),
    clock: harness.clock,
  });
  const accessTokens = new JoseAccessTokenIssuer({
    secret: testEnv().JWT_SECRET,
    clock: harness.clock,
  });
  const startSession = new StartSession({
    sessions: infrastructure.sessions,
    tokenGenerator: infrastructure.tokenGenerator,
    accessTokens,
    clock: harness.clock,
  });
  return { infrastructure, accessTokens, startSession };
}

/** StartSession that always fails, to exercise a failed re-issue after commit. */
class FailingStartSession extends StartSession {
  override execute(): Promise<never> {
    return Promise.reject(new Error('session store down'));
  }
}

interface UseCaseOverrides {
  twoFactor?: TwoFactorRepository;
  startSession?: StartSession;
  attemptLimiter?: AttemptLimiter;
  passwordHasher?: PasswordHasher;
  unitOfWork?: UnitOfWork;
  recoveryCodeGenerator?: RecoveryCodeGenerator;
  reports?: Partial<Record<'refund' | 'record' | 'reissue', unknown[]>>;
}

function useCasesFor(
  infrastructure: IdentityInfrastructure,
  startSession: StartSession,
  overrides: UseCaseOverrides = {},
) {
  const twoFactor = overrides.twoFactor ?? infrastructure.twoFactor;
  const session = overrides.startSession ?? startSession;
  const reports = overrides.reports ?? {};
  const reporter = (kind: 'refund' | 'record' | 'reissue') => (error: unknown) => {
    (reports[kind] ??= []).push(error);
  };
  return {
    getTwoFactorStatus: new GetTwoFactorStatus({
      twoFactor,
      recoveryCodes: infrastructure.recoveryCodes,
    }),
    startTwoFactorSetup: new StartTwoFactorSetup({
      users: infrastructure.users,
      twoFactor,
      totp: infrastructure.totp,
      secretBox: infrastructure.secretBox,
    }),
    enableTwoFactor: new EnableTwoFactor({
      users: infrastructure.users,
      twoFactor,
      totp: infrastructure.totp,
      secretBox: infrastructure.secretBox,
      recoveryCodeGenerator:
        overrides.recoveryCodeGenerator ?? infrastructure.recoveryCodeGenerator,
      passwordHasher: overrides.passwordHasher ?? infrastructure.passwordHasher,
      unitOfWork: overrides.unitOfWork ?? infrastructure.unitOfWork,
      startSession: session,
      clock: infrastructure.clock,
      reportReissueFailure: reporter('reissue'),
    }),
    disableTwoFactor: new DisableTwoFactor({
      users: infrastructure.users,
      twoFactor,
      recoveryCodes: infrastructure.recoveryCodes,
      totp: infrastructure.totp,
      secretBox: infrastructure.secretBox,
      passwordHasher: overrides.passwordHasher ?? infrastructure.passwordHasher,
      attemptLimiter: overrides.attemptLimiter ?? infrastructure.attemptLimiter,
      unitOfWork: overrides.unitOfWork ?? infrastructure.unitOfWork,
      startSession: session,
      clock: infrastructure.clock,
      reportRefundFailure: reporter('refund'),
      reportRecordFailure: reporter('record'),
      reportReissueFailure: reporter('reissue'),
    }),
    verifySecondFactor: new VerifySecondFactor({
      signInChallenges: infrastructure.signInChallenges,
      tokenGenerator: infrastructure.tokenGenerator,
      attemptLimiter: overrides.attemptLimiter ?? infrastructure.attemptLimiter,
      unitOfWork: overrides.unitOfWork ?? infrastructure.unitOfWork,
      startSession: session,
      totp: infrastructure.totp,
      secretBox: infrastructure.secretBox,
      passwordHasher: overrides.passwordHasher ?? infrastructure.passwordHasher,
      clock: infrastructure.clock,
      reportRefundFailure: reporter('refund'),
      reportRecordFailure: reporter('record'),
    }),
  };
}

/** The two-factor routes alone, with injected use cases and a session that names `userId`. */
function routesApp(useCases: ReturnType<typeof useCasesFor>, userId: string): Express {
  const logger = createLogger({ level: 'silent' });
  const fakeSession: RequestHandler = (req, _res, next) => {
    req.auth = { userId, sessionId: 'test-session', emailVerified: true };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(createTwoFactorRoutes({ ...useCases, requireSession: fakeSession, logger }));
  app.use(createErrorHandler(logger));
  return app;
}

// --- Tests --------------------------------------------------------------------------------------

describe('POST /auth/2fa/setup and /auth/2fa/enable (AC-01, AC-02)', () => {
  it('setup returns an otpauth:// URI and a secret with Cache-Control: no-store; enable with a valid code activates 2FA (AC-01)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = await signedIn(harness);

    const before = await status(harness.app, cookies);
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ enabled: false, recoveryCodesRemaining: 0 });

    const started = await setup(harness.app, cookies);
    expect(started.status).toBe(200);
    expect(started.headers['cache-control']).toBe('no-store');
    const { secret, otpauthUri } = started.body as { secret: string; otpauthUri: string };
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri).toBe(
      `otpauth://totp/Pesly:ana%40example.com?secret=${secret}&issuer=Pesly&algorithm=SHA1&digits=6&period=30`,
    );
    // Pending only: the secret is stored sealed, never in the clear (threat R-42).
    expect(await twoFactorEnabled(userId)).toBe(false);
    expect(
      await count('select count(*) as n from user_two_factor where secret_sealed like $1', [
        `%${secret}%`,
      ]),
    ).toBe(0);

    const enabled = await enable(harness.app, cookies, totpNow(secret, harness.clock));
    expect(enabled.status).toBe(200);
    expect(enabled.headers['cache-control']).toBe('no-store');
    expect(await twoFactorEnabled(userId)).toBe(true);
    const after = await status(harness.app, sessionFrom(enabled));
    expect(after.body).toMatchObject({ enabled: true });
  });

  it('enable returns 10 recovery codes once; the status afterwards returns only recoveryCodesRemaining: 10, and no endpoint returns the codes again (AC-02, NFR-02)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const { cookies, recoveryCodes } = await enrolled(harness);

    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const code of recoveryCodes) expect(code).toMatch(DISPLAY_CODE);

    const after = await status(harness.app, cookies);
    expect(after.status).toBe(200);
    expect(after.body).toEqual({ enabled: true, recoveryCodesRemaining: 10 });

    const responses = [
      after,
      await setup(harness.app, cookies),
      await enable(harness.app, cookies, totpNow('A'.repeat(32), harness.clock)),
    ];
    for (const response of responses) {
      const body = JSON.stringify(response.body);
      for (const code of recoveryCodes) {
        expect(body).not.toContain(code);
        expect(body).not.toContain(code.replace('-', ''));
      }
    }

    // NFR-02: only Argon2id hashes, no code in plain text in any form.
    const rows = await connection.pool.query<{ code_hash: string }>(
      'select code_hash from recovery_codes',
    );
    expect(rows.rows).toHaveLength(10);
    const dump = JSON.stringify(rows.rows);
    for (const row of rows.rows) expect(row.code_hash).toMatch(/^\$argon2id\$/);
    for (const code of recoveryCodes) {
      expect(dump).not.toContain(code);
      expect(dump).not.toContain(code.replace('-', ''));
    }
  });

  it('enabling ends every other session of the user (401 on their next use), keeps the caller signed in with new cookies, and enqueues a two_factor_enabled email (AC-07)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const other = await signedIn(harness);
    const caller = await signedIn(harness);
    const { secret } = await startedSetup(harness, caller);

    const enabled = await enable(harness.app, caller, totpNow(secret, harness.clock));
    expect(enabled.status).toBe(200);
    const renewed = sessionFrom(enabled);
    expect(renewed.accessToken).not.toBe(caller.accessToken);

    expect((await currentSession(harness.app, other)).status).toBe(401);
    expect((await refresh(harness.app, other)).status).toBe(401);
    expect((await currentSession(harness.app, caller)).status).toBe(401);
    expect((await refresh(harness.app, caller)).status).toBe(401);
    expect((await currentSession(harness.app, renewed)).status).toBe(200);
    expect((await status(harness.app, renewed)).status).toBe(200);

    expect(await outboxKinds()).toEqual(['two_factor_enabled']);
  });

  it('a password sign-in that read the user before enable commits and creates its session after gets a session rejected with 401 on first use (AC-07, sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const caller = await signedIn(harness);
    const { secret } = await startedSetup(harness, caller);
    const { infrastructure, startSession } = adaptersFor(harness);
    let reading = (): void => undefined;
    const read = new Promise<void>((resolve) => (reading = resolve));
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => (release = resolve));
    // The sign-in has read the user and its 2FA state (still off), and waits before its session.
    const slowTwoFactor = withFindByUserId(infrastructure.twoFactor, async (id) => {
      const settings = await infrastructure.twoFactor.findByUserId(id);
      reading();
      await released;
      return settings;
    });
    const signInUseCase = new SignIn({
      attemptLimiter: infrastructure.attemptLimiter,
      users: infrastructure.users,
      passwordHasher: infrastructure.passwordHasher,
      dummyPasswordHash: DUMMY_PASSWORD_HASH,
      startSession,
      twoFactor: slowTwoFactor,
      createSignInChallenge: new CreateSignInChallenge({
        signInChallenges: infrastructure.signInChallenges,
        tokenGenerator: infrastructure.tokenGenerator,
        clock: harness.clock,
      }),
      reportRefundFailure: () => undefined,
    });

    const racing = signInUseCase.execute({ email: EMAIL, password: PASSWORD, ip: '203.0.113.9' });
    await read;
    expect((await enable(harness.app, caller, totpNow(secret, harness.clock))).status).toBe(200);
    release();
    const result = await racing;

    if (result.outcome !== 'signed_in')
      throw new Error(`expected a session, got ${result.outcome}`);
    const cookies = {
      accessToken: result.session.accessToken,
      refreshToken: result.session.refreshToken,
    };
    expect((await currentSession(harness.app, cookies)).status).toBe(401);
    expect((await refresh(harness.app, cookies)).status).toBe(401);
  });

  it('a Google callback that read the user before enable commits and creates its session after gets a session rejected with 401 on first use (AC-07, sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const caller = await signedIn(harness);
    const { secret } = await startedSetup(harness, caller);
    const { infrastructure, startSession } = adaptersFor(harness);
    await infrastructure.identities.link({
      userId,
      provider: 'google',
      subject: 'sub-ana',
      emailAuthoritative: true,
    });
    const now = harness.clock.now();
    // The enable commits right after the callback read the user through its Google link, and
    // its 2FA state (still off).
    const racing: UnitOfWork = {
      run: (work) =>
        infrastructure.unitOfWork.run((repositories) =>
          work({
            ...repositories,
            twoFactor: withFindByUserId(repositories.twoFactor, async (id) => {
              const settings = await repositories.twoFactor.findByUserId(id);
              const response = await enable(harness.app, caller, totpNow(secret, harness.clock));
              expect(response.status).toBe(200);
              return settings;
            }),
          }),
        ),
    };
    const complete = new CompleteGoogleSignIn({
      oauthStates: {
        create: () => Promise.resolve(),
        consume: () =>
          Promise.resolve({
            stateHash: 'state-hash',
            bindingHash: 'binding-hash',
            nonceHash: 'nonce-hash',
            codeVerifier: 'verifier',
            timeZone: 'UTC',
            language: 'en',
            purpose: 'sign_in',
            userId: null,
            sessionFamilyId: null,
            createdAt: now,
            expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
          }),
      },
      google: {
        authorizationUrl: () => 'unused',
        exchangeCode: () =>
          Promise.resolve({
            subject: 'sub-ana',
            email: EMAIL,
            emailVerified: true,
            hostedDomain: null,
            name: null,
            authTime: null,
          }),
      },
      tokenGenerator: infrastructure.tokenGenerator,
      unitOfWork: racing,
      startSession,
      createSignInChallenge: new CreateSignInChallenge({
        signInChallenges: infrastructure.signInChallenges,
        tokenGenerator: infrastructure.tokenGenerator,
        clock: harness.clock,
      }),
      completeDeletionReauth: new CompleteDeletionReauth({
        identities: infrastructure.identities,
        sessions: infrastructure.sessions,
        deletionGrants: infrastructure.deletionGrants,
        tokenGenerator: infrastructure.tokenGenerator,
        clock: harness.clock,
      }),
      clock: harness.clock,
    });

    const result = await complete.execute({
      params: { state: 'state', code: 'code' },
      binding: 'binding',
    });

    if (result.outcome !== 'signed_in')
      throw new Error(`expected a session, got ${result.outcome}`);
    expect(await twoFactorEnabled(userId)).toBe(true);
    const cookies = {
      accessToken: result.session.accessToken,
      refreshToken: result.session.refreshToken,
    };
    expect((await currentSession(harness.app, cookies)).status).toBe(401);
    expect((await refresh(harness.app, cookies)).status).toBe(401);
  });

  it('a failed session re-issue after enable still answers 200 with the 10 codes, and no cookies (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const caller = await signedIn(harness);
    const { secret } = await startedSetup(harness, caller);
    const { infrastructure, accessTokens } = adaptersFor(harness);
    const reports: UseCaseOverrides['reports'] = {};
    const useCases = useCasesFor(
      infrastructure,
      new FailingStartSession({
        sessions: infrastructure.sessions,
        tokenGenerator: infrastructure.tokenGenerator,
        accessTokens,
        clock: harness.clock,
      }),
      { reports },
    );

    const response = await request(routesApp(useCases, userId))
      .post('/auth/2fa/enable')
      .send({ code: totpNow(secret, harness.clock) });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { recoveryCodes } = response.body as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);
    expect(parseSetCookies(response).size).toBe(0);
    expect(reports.reissue).toHaveLength(1);
    expect(await twoFactorEnabled(userId)).toBe(true);
    // Every earlier session ended anyway: the user signs in again.
    expect((await currentSession(harness.app, caller)).status).toBe(401);
  });

  it('a setup running between an enable’s verify and activate makes that enable answer 409, and 2FA stays off (sad path, R-52)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const caller = await signedIn(harness);
    const { secret } = await startedSetup(harness, caller);
    const { infrastructure, startSession } = adaptersFor(harness);
    const real = infrastructure.twoFactor;
    const racingTwoFactor: TwoFactorRepository = {
      findByUserId: (id) => real.findByUserId(id),
      savePending: (id, sealed) => real.savePending(id, sealed),
      activate: (id, sealed, at) => real.activate(id, sealed, at),
      delete: (id) => real.delete(id),
      // The code was verified against the first secret; a second setup replaces it meanwhile.
      advanceLastUsedStep: async (id, step) => {
        const advanced = await real.advanceLastUsedStep(id, step);
        expect((await setup(harness.app, caller)).status).toBe(200);
        return advanced;
      },
    };
    const useCases = useCasesFor(infrastructure, startSession, { twoFactor: racingTwoFactor });

    const response = await request(routesApp(useCases, userId))
      .post('/auth/2fa/enable')
      .send({ code: totpNow(secret, harness.clock) });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'TWO_FACTOR_SETUP_REQUIRED' });
    expect(await twoFactorEnabled(userId)).toBe(false);
    expect(await count('select count(*) as n from recovery_codes')).toBe(0);
    expect(await outboxKinds()).toEqual([]);
    expect((await currentSession(harness.app, caller)).status).toBe(200);
  });

  it('enable with a wrong code, a replayed code, or without setup is refused and 2FA stays off (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = await signedIn(harness);

    const withoutSetup = await enable(harness.app, cookies, '123456');
    expect(withoutSetup.status).toBe(409);
    expect(withoutSetup.body).toEqual({ code: 'TWO_FACTOR_SETUP_REQUIRED' });

    const { secret } = await startedSetup(harness, cookies);
    const wrong = await enable(harness.app, cookies, wrongCode(secret, harness.clock));
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual({ code: 'TOTP_INVALID' });

    // The current step was already used (e.g. by an observed code): the same code is a replay.
    const code = totpNow(secret, harness.clock);
    await connection.pool.query('update user_two_factor set last_used_step = $1', [
      stepAt(harness.clock) + 1,
    ]);
    const replayed = await enable(harness.app, cookies, code);
    expect(replayed.status).toBe(400);
    expect(replayed.body).toEqual({ code: 'TOTP_INVALID' });

    expect(await twoFactorEnabled(userId)).toBe(false);
    expect(await count('select count(*) as n from recovery_codes')).toBe(0);
    expect(await outboxKinds()).toEqual([]);
    // Nothing changed: the caller's session still works.
    expect((await currentSession(harness.app, cookies)).status).toBe(200);
  });

  it('enable hashes the recovery codes one at a time, never in parallel (R-45)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const caller = await signedIn(harness);
    const { secret } = await startedSetup(harness, caller);
    const { infrastructure, startSession } = adaptersFor(harness);
    let inFlight = 0;
    let maxInFlight = 0;
    const tracking: PasswordHasher = {
      hash: async (value) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          return await infrastructure.passwordHasher.hash(value);
        } finally {
          inFlight -= 1;
        }
      },
      verify: (hash, value) => infrastructure.passwordHasher.verify(hash, value),
    };
    const app = routesApp(
      useCasesFor(infrastructure, startSession, { passwordHasher: tracking }),
      userId,
    );

    const response = await request(app)
      .post('/auth/2fa/enable')
      .send({ code: totpNow(secret, harness.clock) });

    expect(response.status).toBe(200);
    expect(maxInFlight).toBe(1);
  });

  it('enable refuses a generated recovery code that does not normalize (invariant) and 2FA stays off (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const caller = await signedIn(harness);
    const { secret } = await startedSetup(harness, caller);
    const { infrastructure, startSession } = adaptersFor(harness);
    const broken: RecoveryCodeGenerator = {
      generate: (n) => [...infrastructure.recoveryCodeGenerator.generate(n - 1), 'not-a-code!'],
    };
    const app = routesApp(
      useCasesFor(infrastructure, startSession, { recoveryCodeGenerator: broken }),
      userId,
    );

    const response = await request(app)
      .post('/auth/2fa/enable')
      .send({ code: totpNow(secret, harness.clock) });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL' });
    expect(await twoFactorEnabled(userId)).toBe(false);
    expect(await count('select count(*) as n from recovery_codes')).toBe(0);
  });

  it('enable with a pending secret that cannot be opened answers 500, never a wrong code (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = await signedIn(harness);
    const { secret } = await startedSetup(harness, cookies);
    await connection.pool.query("update user_two_factor set secret_sealed = secret_sealed || 'x'");

    const response = await enable(harness.app, cookies, totpNow(secret, harness.clock));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL' });
    expect(await twoFactorEnabled(userId)).toBe(false);
  });

  it('enable accepts a code with surrounding spaces', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = await signedIn(harness);
    const { secret } = await startedSetup(harness, cookies);

    const response = await enable(harness.app, cookies, ` ${totpNow(secret, harness.clock)} `);

    expect(response.status).toBe(200);
    expect(await twoFactorEnabled(userId)).toBe(true);
  });

  it('setup or enable when already enabled answers 409 TWO_FACTOR_ALREADY_ENABLED, and disable when not enabled answers 409 TWO_FACTOR_NOT_ENABLED (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const { cookies, secret, userId } = await enrolled(harness);
    const sealedBefore = await connection.pool.query<{ secret_sealed: string }>(
      'select secret_sealed from user_two_factor',
    );

    const again = await setup(harness.app, cookies);
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ code: 'TWO_FACTOR_ALREADY_ENABLED' });
    const reEnabled = await enable(harness.app, cookies, totpNow(secret, harness.clock));
    expect(reEnabled.status).toBe(409);
    expect(reEnabled.body).toEqual({ code: 'TWO_FACTOR_ALREADY_ENABLED' });
    const sealedAfter = await connection.pool.query<{ secret_sealed: string }>(
      'select secret_sealed from user_two_factor',
    );
    expect(sealedAfter.rows).toEqual(sealedBefore.rows);
    expect(await twoFactorEnabled(userId)).toBe(true);

    await seedUser(connection, { email: 'bea@example.com', password: PASSWORD });
    const bea = await signedIn(harness, 'bea@example.com');
    const notEnabled = await disable(harness.app, bea, '123456');
    expect(notEnabled.status).toBe(409);
    expect(notEnabled.body).toEqual({ code: 'TWO_FACTOR_NOT_ENABLED' });
    // A pending setup is not "enabled" either.
    await startedSetup(harness, bea);
    expect((await disable(harness.app, bea, '123456')).status).toBe(409);
  });
});

describe('POST /auth/2fa/disable (AC-03, AC-07, NFR-04)', () => {
  it('disable with a valid TOTP code turns 2FA off, deletes every recovery code, ends other sessions and enqueues a two_factor_disabled email (AC-03, AC-07)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const { cookies, secret, userId } = await enrolled(harness);
    // With 2FA on, another browser signs in through the second step (Block 3).
    const first = await signIn(harness.app, EMAIL, PASSWORD);
    const challenge = parseSetCookies(first).get('__Secure-argent_mfa')?.value ?? '';
    const second = await request(harness.app)
      .post('/auth/2fa/verify')
      .set(trustedHeaders)
      .set('Cookie', `__Secure-argent_mfa=${challenge}`)
      .send({ code: totpNow(secret, harness.clock) });
    expect(second.status).toBe(200);
    const other = sessionFrom(second);
    harness.clock.advance(STEP_MS);
    await connection.pool.query(
      `insert into sign_in_challenges (token_hash, user_id, credentials_version, via, language, expires_at)
       values ('pending-challenge', $1, 0, 'password', 'es', now() + interval '5 minutes')`,
      [userId],
    );

    const response = await disable(harness.app, cookies, totpNow(secret, harness.clock));

    expect(response.status).toBe(204);
    const renewed = sessionFrom(response);
    expect(await count('select count(*) as n from user_two_factor')).toBe(0);
    expect(await count('select count(*) as n from recovery_codes')).toBe(0);
    expect(await count('select count(*) as n from sign_in_challenges')).toBe(0);
    expect((await currentSession(harness.app, other)).status).toBe(401);
    expect((await currentSession(harness.app, cookies)).status).toBe(401);
    expect((await currentSession(harness.app, renewed)).status).toBe(200);
    expect(await outboxKinds()).toEqual(['two_factor_enabled', 'two_factor_disabled']);
    expect((await status(harness.app, renewed)).body).toEqual({
      enabled: false,
      recoveryCodesRemaining: 0,
    });
    // The disable units were given back; nothing counted toward the sign-in limit.
    expect(await attempts('two_factor_disable_user')).toBe(0);
    expect(await attempts('two_factor_disable_user_24h')).toBe(0);
    expect(await attempts('sign_in_account', EMAIL)).toBe(0);
  });

  it('disable with an unused recovery code turns 2FA off, whatever its case and separators (AC-03)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const { cookies, recoveryCodes } = await enrolled(harness);
    const typed = (recoveryCodes[3] ?? '').toLowerCase().replace('-', ' ');

    const response = await disable(harness.app, cookies, typed);

    expect(response.status).toBe(204);
    expect(await count('select count(*) as n from user_two_factor')).toBe(0);
    expect(await count('select count(*) as n from recovery_codes')).toBe(0);
  });

  it('disable with a wrong, replayed or used code is refused with TOTP_INVALID and changes nothing (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const { cookies, secret, userId, recoveryCodes } = await enrolled(harness);

    const wrong = await disable(harness.app, cookies, wrongCode(secret, harness.clock));
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual({ code: 'TOTP_INVALID' });
    const unknownRecovery = await disable(harness.app, cookies, 'ZZZZZ-ZZZZZ');
    expect(unknownRecovery.status).toBe(400);
    expect(unknownRecovery.body).toEqual({ code: 'TOTP_INVALID' });

    // The code of the step the enable used (one step back) is a replay.
    const replayed = await disable(harness.app, cookies, hotp(secret, stepAt(harness.clock) - 1));
    expect(replayed.status).toBe(400);

    expect(await twoFactorEnabled(userId)).toBe(true);
    expect(await count('select count(*) as n from recovery_codes where used_at is null')).toBe(10);

    // Used recovery codes (as a sign-in would leave them) are refused too.
    await connection.pool.query('update recovery_codes set used_at = now()');
    const used = await disable(harness.app, cookies, recoveryCodes[0]);
    expect(used.status).toBe(400);
    expect(used.body).toEqual({ code: 'TOTP_INVALID' });

    expect(await twoFactorEnabled(userId)).toBe(true);
    expect((await currentSession(harness.app, cookies)).status).toBe(200);
    expect(await outboxKinds()).toEqual(['two_factor_enabled']);
  });

  it('disable with a wrong code is refused and counted; the 6th wrong disable within 15 minutes and the 21st within 24 hours answer 429, and they do not consume the sign-in second-factor units (sad path, NFR-04, NFR-01)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    // Start one minute into a UTC day, so every 15-minute window below shares one 24-hour window.
    const now = harness.clock.now().getTime();
    harness.clock.advance(Math.ceil(now / DAY) * DAY + 60_000 - now);
    const { cookies: enrolledCookies, secret, userId } = await enrolled(harness);
    let cookies = enrolledCookies;

    const first = await disable(harness.app, cookies, wrongCode(secret, harness.clock));
    expect(first.status).toBe(400);
    expect(first.body).toEqual({ code: 'TOTP_INVALID' });
    // NFR-01: the failed code counts toward the per-account sign-in limit.
    expect(await attempts('sign_in_account', EMAIL)).toBe(1);

    for (let n = 2; n <= 5; n += 1) {
      expect((await disable(harness.app, cookies, wrongCode(secret, harness.clock))).status).toBe(
        400,
      );
    }
    const sixth = await disable(harness.app, cookies, totpNow(secret, harness.clock));
    expect(sixth.status).toBe(429);
    expect(sixth.body).toEqual({ code: 'RATE_LIMITED' });
    // The refused attempt gave its units back.
    expect(await attempts('two_factor_disable_user')).toBe(5);
    expect(await attempts('two_factor_disable_user_24h')).toBe(5);
    expect(await attempts('sign_in_account', EMAIL)).toBe(5);

    // Three more 15-minute windows: 20 failures in the day.
    for (let window = 1; window <= 3; window += 1) {
      harness.clock.advance(FIFTEEN_MINUTES);
      cookies = sessionFrom(await refresh(harness.app, cookies));
      for (let n = 1; n <= 5; n += 1) {
        expect((await disable(harness.app, cookies, wrongCode(secret, harness.clock))).status).toBe(
          400,
        );
      }
    }
    harness.clock.advance(FIFTEEN_MINUTES);
    cookies = sessionFrom(await refresh(harness.app, cookies));
    const twentyFirst = await disable(harness.app, cookies, totpNow(secret, harness.clock));
    expect(twentyFirst.status).toBe(429);
    expect(await attempts('two_factor_disable_user_24h')).toBe(20);

    expect(await twoFactorEnabled(userId)).toBe(true);
    // Disabling never spends the sign-in second step's units (R-51).
    expect(await attempts('second_factor_user_15m')).toBe(0);
    expect(await attempts('second_factor_user_24h')).toBe(0);
  });

  it('reports a failed NFR-01 record and keeps the 400, and reports a failed refund and keeps the 429 (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const { secret, userId } = await enrolled(harness);
    const { infrastructure, startSession } = adaptersFor(harness);
    const real = infrastructure.attemptLimiter;
    const failing: AttemptLimiter = {
      isLimitReached: (policy, key) => real.isLimitReached(policy, key),
      record: (policy, key) =>
        policy.kind === 'sign_in_account'
          ? Promise.reject(new Error('limiter down'))
          : real.record(policy, key),
      release: () => Promise.reject(new Error('limiter down')),
    };
    const reports: UseCaseOverrides['reports'] = {};
    const app = routesApp(
      useCasesFor(infrastructure, startSession, { attemptLimiter: failing, reports }),
      userId,
    );

    for (let n = 1; n <= 5; n += 1) {
      const wrong = await request(app)
        .post('/auth/2fa/disable')
        .send({ code: wrongCode(secret, harness.clock) });
      expect(wrong.status).toBe(400);
      expect(wrong.body).toEqual({ code: 'TOTP_INVALID' });
    }
    expect(reports.record).toHaveLength(5);

    const refused = await request(app)
      .post('/auth/2fa/disable')
      .send({ code: totpNow(secret, harness.clock) });
    expect(refused.status).toBe(429);
    expect(reports.refund?.length).toBeGreaterThanOrEqual(1);
    expect(await twoFactorEnabled(userId)).toBe(true);
  });

  it('a transaction fault during disable gives both disable units back (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const { secret, userId } = await enrolled(harness);
    const { infrastructure, startSession } = adaptersFor(harness);
    const faulty: UnitOfWork = { run: () => Promise.reject(new Error('connection terminated')) };
    const app = routesApp(
      useCasesFor(infrastructure, startSession, { unitOfWork: faulty }),
      userId,
    );

    const response = await request(app)
      .post('/auth/2fa/disable')
      .send({ code: totpNow(secret, harness.clock) });

    expect(response.status).toBe(500);
    expect(await disableUnits()).toBe(0);
    expect(await twoFactorEnabled(userId)).toBe(true);
  });

  it('a disable whose transaction finds 2FA already removed answers 409, with no second bump or notice, and gives its units back (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const { secret, userId } = await enrolled(harness);
    const versionBefore = await credentialsVersion(userId);
    const { infrastructure, startSession } = adaptersFor(harness);
    // A concurrent disable commits between this one's code check and its transaction.
    const late: UnitOfWork = {
      run: async (work) => {
        await removeTwoFactorElsewhere();
        return infrastructure.unitOfWork.run(work);
      },
    };
    const app = routesApp(useCasesFor(infrastructure, startSession, { unitOfWork: late }), userId);

    const response = await request(app)
      .post('/auth/2fa/disable')
      .send({ code: totpNow(secret, harness.clock) });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'TWO_FACTOR_NOT_ENABLED' });
    expect(await credentialsVersion(userId)).toBe(versionBefore);
    expect(await outboxKinds()).toEqual(['two_factor_enabled']);
    expect(await disableUnits()).toBe(0);
  });

  it('a disable whose code check fails because 2FA was removed meanwhile answers 409, is not counted as a guess, and gives its units back (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const { secret, userId } = await enrolled(harness);
    const { infrastructure, startSession } = adaptersFor(harness);
    const twoFactor = beforeFirstStep(infrastructure.twoFactor, removeTwoFactorElsewhere);
    const app = routesApp(useCasesFor(infrastructure, startSession, { twoFactor }), userId);

    const response = await request(app)
      .post('/auth/2fa/disable')
      .send({ code: totpNow(secret, harness.clock) });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'TWO_FACTOR_NOT_ENABLED' });
    expect(await disableUnits()).toBe(0);
    expect(await attempts('sign_in_account', EMAIL)).toBe(0);
  });

  it('two concurrent disables: one succeeds, the other answers 409 with its units given back, and only one notice is queued (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const { secret, userId, recoveryCodes } = await enrolled(harness);
    const versionBefore = await credentialsVersion(userId);
    const { infrastructure, startSession } = adaptersFor(harness);
    // Both requests pass the "2FA is enabled" check before either goes on.
    let arrived = 0;
    let openGate = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const real = infrastructure.twoFactor;
    const twoFactor: TwoFactorRepository = {
      findByUserId: async (id) => {
        const settings = await real.findByUserId(id);
        if (arrived < 2) {
          arrived += 1;
          if (arrived === 2) openGate();
          await gate;
        }
        return settings;
      },
      savePending: (id, sealed) => real.savePending(id, sealed),
      activate: (id, sealed, at) => real.activate(id, sealed, at),
      delete: (id) => real.delete(id),
      advanceLastUsedStep: (id, step) => real.advanceLastUsedStep(id, step),
    };
    const app = routesApp(useCasesFor(infrastructure, startSession, { twoFactor }), userId);

    const responses = await Promise.all([
      request(app)
        .post('/auth/2fa/disable')
        .send({ code: totpNow(secret, harness.clock) }),
      request(app).post('/auth/2fa/disable').send({ code: recoveryCodes[0] }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([204, 409]);
    expect(responses.find((response) => response.status === 409)?.body).toEqual({
      code: 'TWO_FACTOR_NOT_ENABLED',
    });
    expect(await outboxKinds()).toEqual(['two_factor_enabled', 'two_factor_disabled']);
    expect(await credentialsVersion(userId)).toBe(versionBefore + 1);
    expect(await disableUnits()).toBe(0);
    expect(await attempts('sign_in_account', EMAIL)).toBe(0);
  });

  it('a failed session re-issue after disable still answers 204, without cookies (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const { secret, userId, cookies } = await enrolled(harness);
    const { infrastructure, accessTokens } = adaptersFor(harness);
    const reports: UseCaseOverrides['reports'] = {};
    const useCases = useCasesFor(
      infrastructure,
      new FailingStartSession({
        sessions: infrastructure.sessions,
        tokenGenerator: infrastructure.tokenGenerator,
        accessTokens,
        clock: harness.clock,
      }),
      { reports },
    );

    const response = await request(routesApp(useCases, userId))
      .post('/auth/2fa/disable')
      .send({ code: totpNow(secret, harness.clock) });

    expect(response.status).toBe(204);
    expect(parseSetCookies(response).size).toBe(0);
    expect(reports.reissue).toHaveLength(1);
    expect(await count('select count(*) as n from user_two_factor')).toBe(0);
    expect((await currentSession(harness.app, cookies)).status).toBe(401);
  });

  it('a sealed secret that cannot be opened answers 500, never a wrong code (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const { cookies, secret } = await enrolled(harness);
    // A damaged sealed value: authenticated decryption fails.
    await connection.pool.query("update user_two_factor set secret_sealed = secret_sealed || 'x'");

    const response = await disable(harness.app, cookies, totpNow(secret, harness.clock));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL' });
    expect(await count('select count(*) as n from user_two_factor')).toBe(1);
    // Not a guess: the disable units went back.
    expect(await disableUnits()).toBe(0);
  });
});

describe('two-factor routes: validation, authentication and availability', () => {
  it('a malformed code answers 400 VALIDATION_FAILED (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const { cookies } = await enrolled(harness);

    for (const code of ['12345', '1234567', 'abcdef', '12 34 56 7', 123456, '', undefined]) {
      const response = await enable(harness.app, cookies, code);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.code'] });
    }
    for (const code of [
      '12345',
      'ABCDE-1234',
      'ABCDE-123456',
      'UUUUU-UUUUU',
      'AB-CDE-12345',
      'ABCDE_12345',
      'ABCDE - 12345 x',
      'A B C D E 1 2 3 4 5',
      'ABCDÉ-12345',
      42,
      undefined,
    ]) {
      const response = await disable(harness.app, cookies, code);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.code'] });
    }
    // Malformed input is refused before any unit is reserved.
    expect(await attempts('two_factor_disable_user')).toBe(0);
  });

  it('every route answers 401 without a session and 403 for an unverified email (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD, verified: false });
    const unverified = await signedIn(harness);

    const calls = [
      (cookies: Partial<SessionCookies>) => status(harness.app, cookies),
      (cookies: Partial<SessionCookies>) => setup(harness.app, cookies),
      (cookies: Partial<SessionCookies>) => enable(harness.app, cookies, '123456'),
      (cookies: Partial<SessionCookies>) => disable(harness.app, cookies, '123456'),
    ];
    for (const call of calls) {
      const anonymous = await call({});
      expect(anonymous.status).toBe(401);
      expect(anonymous.body).toEqual({ code: 'UNAUTHENTICATED' });
      const forbidden = await call(unverified);
      expect(forbidden.status).toBe(403);
      expect(forbidden.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
    }
    expect(await count('select count(*) as n from user_two_factor')).toBe(0);
  });

  it('with no encryption key outside production, setup answers 503 TWO_FACTOR_UNAVAILABLE, and so do enable and disable of an existing secret (sad path)', async () => {
    const withKey = createIdentityHarness(connection, { realSessions: true });
    const { cookies, secret } = await enrolled(withKey);
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      env: { TOTP_ENCRYPTION_KEY: '' },
    });

    const disabled = await disable(harness.app, cookies, totpNow(secret, withKey.clock));
    expect(disabled.status).toBe(503);
    expect(disabled.body).toEqual({ code: 'TWO_FACTOR_UNAVAILABLE' });
    expect(await count('select count(*) as n from user_two_factor')).toBe(1);
    expect(await disableUnits()).toBe(0);

    await seedUser(connection, { email: 'bea@example.com', password: PASSWORD });
    const bea = await signedIn(harness, 'bea@example.com');
    const started = await setup(harness.app, bea);
    expect(started.status).toBe(503);
    expect(started.body).toEqual({ code: 'TWO_FACTOR_UNAVAILABLE' });
    expect(await count('select count(*) as n from user_two_factor')).toBe(1);

    // A pending secret sealed while a key was configured cannot be confirmed without it.
    const { secret: beaSecret } = await startedSetup(withKey, bea);
    const enabled = await enable(harness.app, bea, totpNow(beaSecret, withKey.clock));
    expect(enabled.status).toBe(503);
    expect(enabled.body).toEqual({ code: 'TWO_FACTOR_UNAVAILABLE' });
  });
});

describe('two-factor notices and secrecy (FR-05)', () => {
  it('the notice emails render in es and en, and carry no link, token or code', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const ana = await enrolled(harness, { email: 'ana@example.com', language: 'es' });
    const bob = await enrolled(harness, { email: 'bob@example.com', language: 'en' });
    expect(
      (await disable(harness.app, ana.cookies, totpNow(ana.secret, harness.clock))).status,
    ).toBe(204);
    expect((await disable(harness.app, bob.cookies, bob.recoveryCodes[0])).status).toBe(204);

    await harness.worker.runOnce();

    const sent = harness.transport.sent.map(({ to, subject }) => ({ to, subject }));
    expect(sent).toEqual(
      expect.arrayContaining([
        {
          to: 'ana@example.com',
          subject: 'Se activó la verificación en dos pasos en tu cuenta de Pesly',
        },
        {
          to: 'ana@example.com',
          subject: 'Se desactivó la verificación en dos pasos en tu cuenta de Pesly',
        },
        {
          to: 'bob@example.com',
          subject: 'Two-factor authentication is on for your Pesly account',
        },
        {
          to: 'bob@example.com',
          subject: 'Two-factor authentication is off for your Pesly account',
        },
      ]),
    );
    expect(harness.transport.sent).toHaveLength(4);
    for (const email of harness.transport.sent) {
      const content = `${email.subject}\n${email.text}\n${email.html}`;
      expect(email.link).toBeUndefined();
      expect(email.token).toBeUndefined();
      expect(content).not.toMatch(/https?:\/\//);
      expect(content).not.toMatch(/href=/);
      expect(content).not.toMatch(/\b\d{6}\b/);
      for (const secret of [ana.secret, bob.secret, ...ana.recoveryCodes, ...bob.recoveryCodes]) {
        expect(content).not.toContain(secret);
      }
    }
  });

  it('no log line contains a code, secret or recovery code, and the logger redacts secret, otpauthUri, recoveryCodes and body.code', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const { cookies, secret, recoveryCodes, enableCode } = await enrolled(harness);
    const wrong = wrongCode(secret, harness.clock);
    expect((await disable(harness.app, cookies, wrong)).status).toBe(400);
    expect((await disable(harness.app, cookies, recoveryCodes[1])).status).toBe(204);

    const logs = harness.lines.join('\n');
    for (const value of [
      secret,
      ...recoveryCodes,
      ...recoveryCodes.map((c) => c.replace('-', '')),
    ]) {
      expect(logs).not.toContain(value);
    }
    // Submitted TOTP codes never appear as a logged value.
    for (const code of [enableCode, wrong]) expect(logs).not.toContain(`"${code}"`);
    expect(logs).toContain('two-factor enabled');
    expect(logs).toContain('two-factor disabled');

    const lines: string[] = [];
    const logger = createLogger({ destination: { write: (line: string) => lines.push(line) } });
    logger.info(
      {
        secret: 'S3CR3T',
        otpauthUri: 'otpauth://totp/x?secret=S3CR3T',
        recoveryCodes: ['ABCDE-12345'],
        body: { code: '654321' },
        response: { secret: 'S3CR3T', recoveryCodes: ['ABCDE-12345'] },
      },
      'payload',
    );
    expect(lines.join('')).not.toMatch(/S3CR3T|ABCDE-12345|654321/);
  });
});
