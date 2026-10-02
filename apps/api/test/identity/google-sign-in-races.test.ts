import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompleteGoogleSignIn } from '../../src/identity/application/complete-google-sign-in';
import { CreateSignInChallenge } from '../../src/identity/application/create-sign-in-challenge';
import { GetCurrentSession } from '../../src/identity/application/get-current-session';
import type {
  GoogleClaims,
  GoogleIdentityProvider,
} from '../../src/identity/application/ports/google-identity-provider';
import type { OAuthState } from '../../src/identity/application/ports/oauth-state-repository';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../src/identity/application/ports/unit-of-work';
import type { UserRepository } from '../../src/identity/application/ports/user-repository';
import { StartSession } from '../../src/identity/application/start-session';
import { Email } from '../../src/identity/domain/email';
import { DuplicateEmail, IdentityAlreadyLinked } from '../../src/identity/domain/errors';
import { DrizzleSessionRepository } from '../../src/identity/infrastructure/db/drizzle-session-repository';
import { DrizzleSignInChallengeRepository } from '../../src/identity/infrastructure/db/drizzle-sign-in-challenge-repository';
import { DrizzleUnitOfWork } from '../../src/identity/infrastructure/db/drizzle-unit-of-work';
import { DrizzleUserIdentityRepository } from '../../src/identity/infrastructure/db/drizzle-user-identity-repository';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { CryptoTokenGenerator } from '../../src/identity/infrastructure/security/crypto-token-generator';
import { JoseAccessTokenIssuer } from '../../src/identity/infrastructure/security/jose-access-token-issuer';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { startFakeGoogleOidc, type FakeGoogleOidc } from '../fixtures/fake-google-oidc';
import { MutableClock } from '../fakes/mutable-clock';
import { createIdentityHarness, LINK_BASE_URL } from '../helpers/identity-harness';
import { parseSetCookies } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
let google: FakeGoogleOidc;

beforeAll(async () => {
  connection = createDatabase(testDatabaseUrl);
  google = await startFakeGoogleOidc();
});

afterEach(() => {
  google.resetTokenOptions();
});

afterAll(async () => {
  await google.close();
  await connection.pool.end();
});

const BINDING_COOKIE = '__Secure-argent_oauth';
const NOW = new Date('2026-09-28T12:00:00.000Z');
const CLAIMS: GoogleClaims = {
  subject: 'sub-race',
  email: 'race@gmail.com',
  emailVerified: true,
  hostedDomain: null,
  name: null,
};
const STATE: OAuthState = {
  stateHash: 'state-hash',
  bindingHash: 'binding-hash',
  nonceHash: 'nonce-hash',
  codeVerifier: 'verifier',
  timeZone: 'America/Cordoba',
  language: 'en',
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 10 * 60 * 1000),
};

async function count(table: 'users' | 'user_identities'): Promise<number> {
  const result = await connection.pool.query<{ count: string }>(`select count(*) from ${table}`);
  return Number(result.rows[0]?.count);
}

const clock = new MutableClock(NOW);
const accessTokens = new JoseAccessTokenIssuer({
  secret: 'race-test-secret-that-is-long-enough-for-hs256',
  clock,
});

/** CompleteGoogleSignIn on the test database with a fake provider and a given unit of work. */
function completeWith(unitOfWork: UnitOfWork, claims: GoogleClaims = CLAIMS): CompleteGoogleSignIn {
  const tokenGenerator = new CryptoTokenGenerator();
  const provider: GoogleIdentityProvider = {
    authorizationUrl: () => 'unused',
    exchangeCode: () => Promise.resolve(claims),
  };
  return new CompleteGoogleSignIn({
    oauthStates: { create: () => Promise.resolve(), consume: () => Promise.resolve(STATE) },
    google: provider,
    tokenGenerator,
    unitOfWork,
    startSession: new StartSession({
      sessions: new DrizzleSessionRepository(connection.db),
      tokenGenerator,
      accessTokens,
      clock,
    }),
    createSignInChallenge: new CreateSignInChallenge({
      signInChallenges: new DrizzleSignInChallengeRepository(connection.db),
      tokenGenerator,
      clock,
    }),
    clock,
  });
}

/** What `requireSession` would decide for an access token: null answers 401. */
function currentSession(accessToken: string) {
  return new GetCurrentSession({
    accessTokens,
    sessions: new DrizzleSessionRepository(connection.db),
    users: new DrizzleUserRepository(connection.db),
    clock,
  }).execute(accessToken);
}

/**
 * Wraps a transactional repository so `hook` runs, and commits on its own connection, right after
 * the first call of a method whose name starts with `prefix` resolves.
 */
function afterFirstCall<T extends object>(target: T, prefix: string, hook: () => Promise<void>): T {
  let fired = false;
  return new Proxy(target, {
    get(object, property) {
      const value: unknown = Reflect.get(object, property);
      if (typeof value !== 'function' || typeof property !== 'string') return value;
      if (!property.startsWith(prefix)) return value.bind(object) as unknown;
      return async (...args: unknown[]) => {
        const result: unknown = await (value as (...a: unknown[]) => Promise<unknown>).apply(
          object,
          args,
        );
        if (!fired) {
          fired = true;
          await hook();
        }
        return result;
      };
    },
  });
}

/** A unit of work whose repositories are replaced by `wrap` inside the real transaction. */
function hookedUnitOfWork(
  wrap: (repositories: TransactionalRepositories) => TransactionalRepositories,
): UnitOfWork {
  const real = new DrizzleUnitOfWork(connection.db, clock);
  return { run: (work) => real.run((repositories) => work(wrap(repositories))) };
}

async function seedAccount(email: string, options: { verified: boolean }) {
  return new DrizzleUserRepository(connection.db).create({
    email: Email.parse(email),
    passwordHash: 'kept-hash',
    ...(options.verified ? { emailVerifiedAt: NOW } : {}),
    defaultRateType: 'mep',
    displayCurrency: 'ARS',
    timeZone: 'UTC',
    language: 'en',
  });
}

const INPUT = { params: { state: 'state', code: 'code' }, binding: 'binding' };

describe('concurrent Google callbacks', () => {
  it('end with exactly one user and one identity for the same new Google subject (outcome only; the retry is forced below) (sad path)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true, google });
    const identity = { sub: 'sub-race', email: 'race@gmail.com', emailVerified: true };
    const prepared = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const started = await request(harness.app)
          .get('/auth/google/start')
          .query({ language: 'en' });
        const binding = parseSetCookies(started).get(BINDING_COOKIE)?.value ?? '';
        const { continueUrl } = await google.consent(started.headers.location as string, identity);
        return { continueUrl: new URL(continueUrl), binding };
      }),
    );

    const responses = await Promise.all(
      prepared.map(({ continueUrl, binding }) =>
        request(harness.app)
          .get(`${continueUrl.pathname}${continueUrl.search}`)
          .set('Cookie', `${BINDING_COOKIE}=${binding}`),
      ),
    );

    expect(await count('users')).toBe(1);
    expect(await count('user_identities')).toBe(1);
    // Losers of the race retry once and sign in to the winner's account.
    for (const response of responses) {
      expect(response.headers.location).toBe(`${LINK_BASE_URL}/en`);
    }
  });

  it('retries once, as a new transaction, when a concurrent callback created the user first', async () => {
    const real = new DrizzleUnitOfWork(connection.db, new MutableClock(NOW));
    let runs = 0;
    // The competitor commits between this transaction's lookups and its insert.
    const racing: UnitOfWork = {
      run: (work) =>
        real.run((repositories: TransactionalRepositories) => {
          runs += 1;
          if (runs > 1) return work(repositories);
          const users: UserRepository = {
            findById: (id) => repositories.users.findById(id),
            findByEmail: (email) => repositories.users.findByEmail(email),
            markEmailVerified: (id, at) => repositories.users.markEmailVerified(id, at),
            changePassword: (id, hash, at) => repositories.users.changePassword(id, hash, at),
            supersedeUnverified: (id, at, displayName) =>
              repositories.users.supersedeUnverified(id, at, displayName),
            bumpCredentialsVersion: (id) => repositories.users.bumpCredentialsVersion(id),
            create: async (user) => {
              const winner = await new DrizzleUserRepository(connection.db).create({
                ...user,
                passwordHash: null,
              });
              await new DrizzleUserIdentityRepository(connection.db).link({
                userId: winner.id,
                provider: 'google',
                subject: CLAIMS.subject,
                emailAuthoritative: true,
              });
              return repositories.users.create(user);
            },
          };
          return work({ ...repositories, users });
        }),
    };

    const result = await completeWith(racing).execute(INPUT);

    expect(runs).toBe(2);
    expect(result).toMatchObject({ outcome: 'signed_in', via: 'existing_identity' });
    expect(await count('users')).toBe(1);
    expect(await count('user_identities')).toBe(1);
    const winner = await new DrizzleUserRepository(connection.db).findByEmail(
      Email.parse(CLAIMS.email),
    );
    expect(result.outcome === 'signed_in' && result.user.id).toBe(winner?.id);
  });

  it('stores no display name when creating the account fails, and passes the Google name only to the create call (FR-04)', async () => {
    const real = new DrizzleUnitOfWork(connection.db, new MutableClock(NOW));
    const named: GoogleClaims = { ...CLAIMS, name: 'Race Runner' };
    const created: (string | null | undefined)[] = [];
    const failingInsert: UnitOfWork = {
      run: (work) =>
        real.run((repositories: TransactionalRepositories) => {
          const users: UserRepository = {
            findById: (id) => repositories.users.findById(id),
            findByEmail: (email) => repositories.users.findByEmail(email),
            markEmailVerified: (id, at) => repositories.users.markEmailVerified(id, at),
            changePassword: (id, hash, at) => repositories.users.changePassword(id, hash, at),
            supersedeUnverified: (id, at, displayName) =>
              repositories.users.supersedeUnverified(id, at, displayName),
            bumpCredentialsVersion: (id) => repositories.users.bumpCredentialsVersion(id),
            create: async (user) => {
              created.push(user.displayName);
              await repositories.users.create(user);
              throw new DuplicateEmail();
            },
          };
          return work({ ...repositories, users });
        }),
    };

    const result = await completeWith(failingInsert, named).execute(INPUT);

    expect(result).toEqual({ outcome: 'failed', reason: 'conflict', language: 'en' });
    expect(created).toEqual(['Race Runner', 'Race Runner']);
    expect(await count('users')).toBe(0);
  });

  it('signs in to the account a concurrent callback created between the identity and the email lookups', async () => {
    let winner: Awaited<ReturnType<CompleteGoogleSignIn['execute']>> | undefined;
    // The competitor commits the same Google account right after this transaction found no link.
    const racing = hookedUnitOfWork((repositories) => ({
      ...repositories,
      identities: afterFirstCall(repositories.identities, 'findUserByProviderSubject', async () => {
        winner = await completeWith(new DrizzleUnitOfWork(connection.db, clock)).execute(INPUT);
      }),
    }));

    const result = await completeWith(racing).execute(INPUT);

    expect(winner).toMatchObject({ outcome: 'signed_in', via: 'created' });
    expect(result).toMatchObject({ outcome: 'signed_in', via: 'existing_identity' });
    expect(result.outcome === 'signed_in' && result.user.id).toBe(
      winner?.outcome === 'signed_in' && winner.user.id,
    );
    expect(await count('users')).toBe(1);
    expect(await count('user_identities')).toBe(1);
  });

  it('identity error: still refuses a user whose Google identity has a different subject, creating nothing', async () => {
    const owner = await seedAccount(CLAIMS.email, { verified: true });
    await new DrizzleUserIdentityRepository(connection.db).link({
      userId: owner.id,
      provider: 'google',
      subject: 'sub-another-google-account',
      emailAuthoritative: true,
    });

    const result = await completeWith(new DrizzleUnitOfWork(connection.db, clock)).execute(INPUT);

    expect(result).toEqual({
      outcome: 'failed',
      reason: 'another_identity_linked',
      language: 'en',
    });
    expect(await count('users')).toBe(1);
    expect(await count('user_identities')).toBe(1);
  });

  it('fails after a second conflict instead of retrying again (sad path)', async () => {
    let runs = 0;
    const alwaysConflicting: UnitOfWork = {
      run: () => {
        runs += 1;
        return Promise.reject(new IdentityAlreadyLinked());
      },
    };

    const result = await completeWith(alwaysConflicting).execute(INPUT);

    expect(runs).toBe(2);
    expect(result).toEqual({ outcome: 'failed', reason: 'conflict', language: 'en' });
  });

  it('lets an unexpected database fault through instead of turning it into a failure redirect', async () => {
    const fault = new Error('connection terminated');
    const broken: UnitOfWork = { run: () => Promise.reject(fault) };

    await expect(completeWith(broken).execute(INPUT)).rejects.toBe(fault);
  });

  it('never leaves a live session to a non-authoritative identity that a concurrent reset removes (R-37, AC-10)', async () => {
    const gil = await seedAccount('gil@example.com', { verified: true });
    await new DrizzleUserIdentityRepository(connection.db).link({
      userId: gil.id,
      provider: 'google',
      subject: 'sub-gil',
      emailAuthoritative: false,
    });
    // ConfirmPasswordReset's writes, committed right after the callback looked the identity up.
    const commitReset = () =>
      new DrizzleUnitOfWork(connection.db, clock).run(async ({ users, sessions, identities }) => {
        await users.changePassword(gil.id, 'reset-hash', NOW);
        await sessions.revokeAllForUser(gil.id, NOW);
        await identities.deleteNonAuthoritativeForUser(gil.id);
      });
    const racing = hookedUnitOfWork((repositories) => ({
      ...repositories,
      identities: afterFirstCall(repositories.identities, 'findUser', commitReset),
    }));

    const result = await completeWith(racing, {
      subject: 'sub-gil',
      email: 'gil@example.com',
      emailVerified: true,
      hostedDomain: null,
      name: null,
    }).execute(INPUT);

    expect(await count('user_identities')).toBe(0);
    const live =
      result.outcome === 'signed_in' ? await currentSession(result.session.accessToken) : null;
    expect(live).toBeNull();
  });

  it('links without superseding when the account is verified between the lookup and the supersede', async () => {
    const racer = await seedAccount(CLAIMS.email, { verified: false });
    const verifyElsewhere = () =>
      new DrizzleUserRepository(connection.db).markEmailVerified(racer.id, NOW);
    const racing = hookedUnitOfWork((repositories) => ({
      ...repositories,
      users: afterFirstCall(repositories.users, 'findByEmail', verifyElsewhere),
    }));

    const result = await completeWith(racing).execute(INPUT);

    expect(result).toMatchObject({ outcome: 'signed_in', via: 'linked', user: { id: racer.id } });
    const [row] = (
      await connection.pool.query<{ password_hash: string | null; credentials_version: number }>(
        'select password_hash, credentials_version from users',
      )
    ).rows;
    expect(row).toEqual({ password_hash: 'kept-hash', credentials_version: 0 });
    expect(await count('user_identities')).toBe(1);
    const live =
      result.outcome === 'signed_in' ? await currentSession(result.session.accessToken) : null;
    expect(live?.user.id).toBe(racer.id);
  });
});
