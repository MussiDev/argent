import { DEFAULT_CATEGORIES } from '@pesly/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDefaultCategories } from '../../src/categories';
import { DrizzleCategoryRepository } from '../../src/categories/infrastructure/db/drizzle-category-repository';
import type { UserCreatedHook } from '../../src/identity';
import { OwnerOrGroupMemberAccessPolicy, type AccessScope } from '../../src/shared/access';
import { DenyAllGroupMembershipReader } from '../../src/shared/access/infrastructure/deny-all-group-membership-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { startFakeGoogleOidc, type FakeGoogleOidc } from '../fixtures/fake-google-oidc';
import {
  createIdentityHarness,
  logEntries,
  type IdentityHarness,
  type IdentityHarnessOptions,
} from '../helpers/identity-harness';
import {
  currentSession,
  parseSetCookies,
  seedUser,
  sessionFrom,
  signIn,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';

let connection: DatabaseConnection;
let google: FakeGoogleOidc;

beforeAll(async () => {
  connection = createDatabase(testDatabaseUrl);
  google = await startFakeGoogleOidc();
});

afterAll(async () => {
  await google.close();
  await connection.pool.end();
});

const BINDING_COOKIE = '__Secure-argent_oauth';
const PASSWORD = 'a long enough passphrase';
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const DEVICE = { timeZone: 'America/Cordoba', language: 'en' };
const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());

function harnessFor(options: IdentityHarnessOptions & { hooks?: UserCreatedHook[] } = {}) {
  const { hooks = [seedDefaultCategories], ...rest } = options;
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    google,
    env: { TRUST_PROXY: '1' },
    onUserCreated: hooks,
    ...rest,
  });
  // Rate-limit windows are fixed 15 minutes: start at the top of one so no test crosses a boundary.
  const now = harness.clock.now().getTime();
  harness.clock.advance(FIFTEEN_MINUTES - (now % FIFTEEN_MINUTES));
  return harness;
}

function register(harness: IdentityHarness, email: string, ip = '203.0.113.9') {
  return request(harness.app)
    .post('/auth/register')
    .set(trustedHeaders)
    .set('X-Forwarded-For', ip)
    .send({ email, password: PASSWORD });
}

async function googleSignIn(harness: IdentityHarness, email: string, sub: string) {
  const started = await request(harness.app)
    .get('/auth/google/start')
    .query(DEVICE)
    .set('X-Forwarded-For', '198.51.100.7');
  expect(started.status).toBe(302);
  const binding = parseSetCookies(started).get(BINDING_COOKIE)?.value ?? '';
  const { continueUrl } = await google.consent(started.headers.location as string, {
    sub,
    email,
    emailVerified: true,
  });
  const target = new URL(continueUrl);
  return request(harness.app)
    .get(`${target.pathname}${target.search}`)
    .set('Cookie', `${BINDING_COOKIE}=${binding}`);
}

interface CategoryRow {
  default_key: string | null;
  kind: string;
  parent_key: string | null;
}

/** Read straight from the table: no categories request has run yet. */
async function categoryRows(userId: string): Promise<CategoryRow[]> {
  const result = await connection.pool.query<CategoryRow>(
    `select c.default_key, c.kind, p.default_key as parent_key
       from categories c left join categories p on p.id = c.parent_id
      where c.owner_id = $1`,
    [userId],
  );
  return result.rows.sort((a, b) => (a.default_key ?? '').localeCompare(b.default_key ?? ''));
}

const EXPECTED_DEFAULTS: CategoryRow[] = DEFAULT_CATEGORIES.map((entry) => ({
  default_key: entry.key,
  kind: entry.kind,
  parent_key: entry.parentKey,
})).sort((a, b) => a.default_key.localeCompare(b.default_key));

async function count(table: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(`select count(*) as n from ${table}`);
  return Number(result.rows[0]?.n);
}

async function userIdOf(email: string): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    'select id from users where email = $1',
    [email],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`No user ${email}`);
  return id;
}

function writeScope(userId: string): Promise<AccessScope<'write'>> {
  return policy.scopeFor({ userId, sessionId: 's', emailVerified: true }, 'write');
}

const boom: UserCreatedHook = () => Promise.reject(new Error('seeding failed'));

describe('defaults at account creation', () => {
  it('gives a user registered with email and password exactly the 33 defaults (AC-01)', async () => {
    const harness = harnessFor();

    const response = await register(harness, 'ana@example.com');

    expect(response.status).toBe(202);
    const rows = await categoryRows(await userIdOf('ana@example.com'));
    expect(rows).toHaveLength(33);
    expect(rows).toEqual(EXPECTED_DEFAULTS);
    expect(await count('category_defaults_seeded')).toBe(1);
  });

  it('gives a user created by Google sign-up exactly the defaults and a working session (AC-18)', async () => {
    const harness = harnessFor();

    const response = await googleSignIn(harness, 'bea@gmail.com', 'sub-bea');

    expect(response.status).toBe(302);
    const userId = await userIdOf('bea@gmail.com');
    expect(await categoryRows(userId)).toEqual(EXPECTED_DEFAULTS);
    const session = await currentSession(harness.app, sessionFrom(response));
    expect(session.body).toMatchObject({ user: { id: userId } });
  });

  it('rolls registration back when the hook throws: no user, no verification email, no categories (AC-19)', async () => {
    const harness = harnessFor({ hooks: [boom] });

    const response = await register(harness, 'ana@example.com');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL' });
    const failure = logEntries(harness.lines).find((entry) => entry.msg === 'request failed');
    expect(failure?.err).toMatchObject({
      type: 'NewUserProvisioningFailed',
      cause: { type: 'Error', message: 'seeding failed' },
    });
    expect(await count('users')).toBe(0);
    expect(await count('email_outbox')).toBe(0);
    expect(await count('categories')).toBe(0);
    expect(await count('category_defaults_seeded')).toBe(0);
  });

  it('rolls Google sign-up back when the hook throws: no user, link or session, state consumed (AC-19)', async () => {
    const harness = harnessFor({ hooks: [boom] });

    const response = await googleSignIn(harness, 'bea@gmail.com', 'sub-bea');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL' });
    const cookies = parseSetCookies(response);
    expect(cookies.has(ACCESS_COOKIE)).toBe(false);
    expect(cookies.has(REFRESH_COOKIE)).toBe(false);
    expect(await count('users')).toBe(0);
    expect(await count('user_identities')).toBe(0);
    expect(await count('sessions')).toBe(0);
    expect(await count('categories')).toBe(0);
    expect(await count('oauth_states')).toBe(0);
  });

  it('creates no categories and no error for a registration on an existing email (FR-01)', async () => {
    const harness = harnessFor();
    const existing = await seedUser(connection, { email: 'ana@example.com', password: PASSWORD });

    const response = await register(harness, 'ana@example.com');

    expect(response.status).toBe(202);
    expect(await categoryRows(existing)).toEqual([]);
    expect(await count('categories')).toBe(0);
    expect(await count('category_defaults_seeded')).toBe(0);
  });

  it('creates no categories on the Google supersede path (FR-01)', async () => {
    const harness = harnessFor();
    const squatter = await seedUser(connection, {
      email: 'dan@gmail.com',
      password: PASSWORD,
      verified: false,
    });

    const response = await googleSignIn(harness, 'dan@gmail.com', 'sub-dan');

    expect(response.status).toBe(302);
    expect(response.headers.location).not.toMatch(/error=/);
    expect(await userIdOf('dan@gmail.com')).toBe(squatter);
    expect(await count('categories')).toBe(0);
    expect(await count('category_defaults_seeded')).toBe(0);
  });

  it('gives two registered users each their own set (AC-22)', async () => {
    const harness = harnessFor();

    await register(harness, 'ana@example.com', '203.0.113.10');
    await register(harness, 'ben@example.com', '203.0.113.11');

    const ana = await userIdOf('ana@example.com');
    const ben = await userIdOf('ben@example.com');
    expect(await categoryRows(ana)).toEqual(EXPECTED_DEFAULTS);
    expect(await categoryRows(ben)).toEqual(EXPECTED_DEFAULTS);
    expect(await count('categories')).toBe(66);
    const shared = await connection.pool.query(
      'select id from categories group by id having count(distinct owner_id) > 1',
    );
    expect(shared.rowCount).toBe(0);
  });

  it('does not recreate a default the user deleted, on a later sign-in or safety-net call (AC-22)', async () => {
    const harness = harnessFor();
    await register(harness, 'ana@example.com');
    const ana = await userIdOf('ana@example.com');
    const leaf = DEFAULT_CATEGORIES.find((entry) => entry.parentKey !== null)?.key ?? '';
    await connection.pool.query('delete from categories where owner_id = $1 and default_key = $2', [
      ana,
      leaf,
    ]);

    const signedIn = await signIn(harness.app, 'ana@example.com', PASSWORD);
    await new DrizzleCategoryRepository(connection.db).ensureDefaults(await writeScope(ana));

    expect(signedIn.status).toBe(200);
    const keys = (await categoryRows(ana)).map((row) => row.default_key);
    expect(keys).toHaveLength(32);
    expect(keys).not.toContain(leaf);
  });

  it('leaves a user inserted without the unit of work with no rows until ensureDefaults seeds them (D9)', async () => {
    const userId = await seedUser(connection, { email: 'cy@example.com', password: PASSWORD });
    expect(await categoryRows(userId)).toEqual([]);

    const repository = new DrizzleCategoryRepository(connection.db);
    await repository.ensureDefaults(await writeScope(userId));
    await repository.ensureDefaults(await writeScope(userId));

    expect(await categoryRows(userId)).toEqual(EXPECTED_DEFAULTS);
  });

  it('keeps registration and Google sign-up working, with no categories, when no hook is registered', async () => {
    const harness = harnessFor({ hooks: [] });

    const registered = await register(harness, 'ana@example.com');
    const google1: Response = await googleSignIn(harness, 'bea@gmail.com', 'sub-bea');

    expect(registered.status).toBe(202);
    expect(google1.status).toBe(302);
    expect((await currentSession(harness.app, sessionFrom(google1))).status).toBe(200);
    expect(await count('users')).toBe(2);
    expect(await count('categories')).toBe(0);
  });
});
