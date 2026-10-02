import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RouterFactory } from '../../src/app';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { FixtureGroupMembershipReader } from '../fixtures/fixture-group-membership-reader';
import { applyFixtureSchema } from '../fixtures/fixture-resource-repository';
import { fixtureResourceRoutes } from '../fixtures/fixture-resource-routes';
import { createIdentityHarness, type IdentityHarness } from '../helpers/identity-harness';
import {
  cookieHeader,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { productionOverrides, trustedHeaders } from '../helpers/test-env';

let connection: DatabaseConnection;

beforeAll(async () => {
  connection = createDatabase(testDatabaseUrl);
  await applyFixtureSchema(connection.pool);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';
const ANA = 'ana@example.com';
const BOB = 'bob@example.com';
const CARL = 'carl@example.com';

type Reader = 'fixture' | 'default';

function harnessWith(reader: Reader = 'fixture'): IdentityHarness {
  const routes = fixtureResourceRoutes({
    db: connection.db,
    ...(reader === 'fixture'
      ? { groupMembership: new FixtureGroupMembershipReader(connection.db) }
      : {}),
  });
  return createIdentityHarness(connection, { realSessions: true, testRouterFactories: [routes] });
}

async function insertFixture(
  ownerId: string,
  name: string,
  groupId: string | null = null,
): Promise<string> {
  const id = randomUUID();
  await connection.pool.query(
    'insert into test_fixture_resources (id, owner_id, group_id, name) values ($1, $2, $3, $4)',
    [id, ownerId, groupId, name],
  );
  return id;
}

async function fixtureRow(id: string): Promise<{ name: string } | undefined> {
  const result = await connection.pool.query<{ name: string }>(
    'select name from test_fixture_resources where id = $1',
    [id],
  );
  return result.rows[0];
}

async function addMembers(groupId: string, userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    await connection.pool.query(
      'insert into test_fixture_group_members (group_id, user_id) values ($1, $2)',
      [groupId, userId],
    );
  }
}

async function sessionOf(app: Express, email: string): Promise<SessionCookies> {
  return sessionFrom(await signIn(app, email, PASSWORD));
}

function read(app: Express, id: string, cookies?: Partial<SessionCookies>) {
  const call = request(app).get(`/test-fixtures/${id}`);
  if (cookies) call.set('Cookie', cookieHeader(cookies));
  return call;
}

function rename(app: Express, id: string, name: string, cookies?: Partial<SessionCookies>) {
  const call = request(app).patch(`/test-fixtures/${id}`).set(trustedHeaders);
  if (cookies) call.set('Cookie', cookieHeader(cookies));
  return call.send({ name });
}

function remove(app: Express, id: string, cookies?: Partial<SessionCookies>) {
  const call = request(app).delete(`/test-fixtures/${id}`).set(trustedHeaders);
  if (cookies) call.set('Cookie', cookieHeader(cookies));
  return call.send();
}

describe('financial routes without a valid session (AC-14)', () => {
  it('answer 401 UNAUTHENTICATED with no cookie or a forged one, and change nothing', async () => {
    const harness = harnessWith();
    const anaId = await seedUser(connection, { email: ANA, password: PASSWORD });
    const id = await insertFixture(anaId, 'wallet');
    const forged = { accessToken: 'not-a-jwt' };

    const responses = [
      await read(harness.app, id),
      await rename(harness.app, id, 'hacked'),
      await remove(harness.app, id),
      await read(harness.app, id, forged),
      await rename(harness.app, id, 'hacked', forged),
      await remove(harness.app, id, forged),
    ];

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
    }
    expect(await fixtureRow(id)).toEqual({ name: 'wallet' });
  });
});

describe('unverified email (AC-04, AC-05)', () => {
  it('denies an unverified user their own resource with 403 EMAIL_NOT_VERIFIED', async () => {
    const harness = harnessWith();
    const bobId = await seedUser(connection, { email: BOB, password: PASSWORD, verified: false });
    const id = await insertFixture(bobId, 'wallet');
    const bob = await sessionOf(harness.app, BOB);

    const responses = [
      await read(harness.app, id, bob),
      await rename(harness.app, id, 'renamed', bob),
      await remove(harness.app, id, bob),
    ];

    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
    }
    expect(await fixtureRow(id)).toEqual({ name: 'wallet' });
  });

  it('grants access to the same session once the verification link is opened', async () => {
    const harness = harnessWith();
    const registered = await request(harness.app)
      .post('/auth/register')
      .set(trustedHeaders)
      .send({ email: BOB, password: PASSWORD, displayName: 'Bob' });
    expect(registered.status).toBe(202);
    await harness.worker.runOnce();
    const token = harness.transport.lastTokenFor(BOB);
    const user = await connection.pool.query<{ id: string }>(
      'select id from users where email = $1',
      [BOB],
    );
    const bobId = user.rows[0]?.id;
    if (!bobId) throw new Error('registration did not create the user');
    const id = await insertFixture(bobId, 'wallet');
    const bob = await sessionOf(harness.app, BOB);
    expect((await read(harness.app, id, bob)).status).toBe(403);

    const verified = await request(harness.app)
      .post('/auth/verify-email')
      .set(trustedHeaders)
      .send({ token });
    expect(verified.status).toBe(200);

    const response = await read(harness.app, id, bob);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id, name: 'wallet' });
  });
});

describe('ownership (AC-15, AC-16)', () => {
  it('lets the owner read, update and delete their resource', async () => {
    const harness = harnessWith();
    const anaId = await seedUser(connection, { email: ANA, password: PASSWORD });
    const id = await insertFixture(anaId, 'wallet');
    const ana = await sessionOf(harness.app, ANA);

    const found = await read(harness.app, id, ana);
    expect(found.status).toBe(200);
    expect(found.body).toEqual({ id, name: 'wallet' });
    const renamed = await rename(harness.app, id, 'savings', ana);
    expect(renamed.status).toBe(200);
    expect(renamed.body).toEqual({ id, name: 'savings' });
    expect(await fixtureRow(id)).toEqual({ name: 'savings' });
    expect((await remove(harness.app, id, ana)).status).toBe(204);
    expect(await fixtureRow(id)).toBeUndefined();
  });

  it('answers 404 to reading another user resource, with the same body as a non-existent id', async () => {
    const harness = harnessWith();
    const anaId = await seedUser(connection, { email: ANA, password: PASSWORD });
    await seedUser(connection, { email: BOB, password: PASSWORD });
    const anasId = await insertFixture(anaId, 'wallet');
    const ana = await sessionOf(harness.app, ANA);
    const bob = await sessionOf(harness.app, BOB);
    expect((await read(harness.app, anasId, ana)).status).toBe(200);

    const foreign = await read(harness.app, anasId, bob);
    const missing = await read(harness.app, randomUUID(), bob);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ code: 'NOT_FOUND' });
    expect(missing.status).toBe(foreign.status);
    expect(missing.body).toEqual(foreign.body);
    expect(missing.headers['content-type']).toBe(foreign.headers['content-type']);
  });

  it('answers 404 to updating or deleting another user resource and leaves it unchanged', async () => {
    const harness = harnessWith();
    const anaId = await seedUser(connection, { email: ANA, password: PASSWORD });
    await seedUser(connection, { email: BOB, password: PASSWORD });
    const id = await insertFixture(anaId, 'wallet');
    const bob = await sessionOf(harness.app, BOB);

    const responses = [
      await rename(harness.app, id, 'hacked', bob),
      await remove(harness.app, id, bob),
      await rename(harness.app, randomUUID(), 'hacked', bob),
      await remove(harness.app, randomUUID(), bob),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ code: 'NOT_FOUND' });
    }
    expect(await fixtureRow(id)).toEqual({ name: 'wallet' });
    const owner = await read(harness.app, id, await sessionOf(harness.app, ANA));
    expect(owner.status).toBe(200);
    expect(owner.body).toEqual({ id, name: 'wallet' });
  });
});

describe('group sharing (AC-17)', () => {
  it('lets a group member read a resource shared through the group; others still get 404', async () => {
    const harness = harnessWith('fixture');
    const anaId = await seedUser(connection, { email: ANA, password: PASSWORD });
    const bobId = await seedUser(connection, { email: BOB, password: PASSWORD });
    await seedUser(connection, { email: CARL, password: PASSWORD });
    const groupId = randomUUID();
    await addMembers(groupId, [anaId, bobId]);
    const shared = await insertFixture(anaId, 'household', groupId);
    const privateId = await insertFixture(anaId, 'wallet');
    const bob = await sessionOf(harness.app, BOB);
    const carl = await sessionOf(harness.app, CARL);

    const response = await read(harness.app, shared, bob);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: shared, name: 'household' });
    expect((await read(harness.app, privateId, bob)).status).toBe(404);
    expect((await read(harness.app, shared, carl)).status).toBe(404);
  });

  it('lets a group member read but not update or delete a shared resource (writes are owner-only)', async () => {
    const harness = harnessWith('fixture');
    const anaId = await seedUser(connection, { email: ANA, password: PASSWORD });
    const bobId = await seedUser(connection, { email: BOB, password: PASSWORD });
    const groupId = randomUUID();
    await addMembers(groupId, [anaId, bobId]);
    const shared = await insertFixture(anaId, 'household', groupId);
    const bob = await sessionOf(harness.app, BOB);
    expect((await read(harness.app, shared, bob)).status).toBe(200);

    const responses = [
      await rename(harness.app, shared, 'hacked', bob),
      await remove(harness.app, shared, bob),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ code: 'NOT_FOUND' });
    }
    expect(await fixtureRow(shared)).toEqual({ name: 'household' });
  });

  it('denies group access with the default membership reader', async () => {
    const harness = harnessWith('default');
    const anaId = await seedUser(connection, { email: ANA, password: PASSWORD });
    const bobId = await seedUser(connection, { email: BOB, password: PASSWORD });
    const groupId = randomUUID();
    await addMembers(groupId, [anaId, bobId]);
    const shared = await insertFixture(anaId, 'household', groupId);
    const ana = await sessionOf(harness.app, ANA);
    const bob = await sessionOf(harness.app, BOB);
    expect((await read(harness.app, shared, ana)).status).toBe(200);

    const response = await read(harness.app, shared, bob);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'NOT_FOUND' });
  });
});

describe('fixture routes outside NODE_ENV=test', () => {
  it.each([
    ['development', { NODE_ENV: 'development' }],
    ['production', productionOverrides],
  ])('are not mounted in %s: the owner with a session gets 404', async (_name, env) => {
    const anaId = await seedUser(connection, { email: ANA, password: PASSWORD });
    const id = await insertFixture(anaId, 'wallet');
    // Control: the same factory and the same session request work when NODE_ENV is test.
    const inTest = createIdentityHarness(connection, {
      realSessions: true,
      testRouterFactories: [fixtureResourceRoutes({ db: connection.db })],
    });
    const ana = await sessionOf(inTest.app, ANA);
    expect((await read(inTest.app, id, ana)).status).toBe(200);

    const factory = vi.fn<RouterFactory>(fixtureResourceRoutes({ db: connection.db }));
    const outside = createIdentityHarness(connection, {
      realSessions: true,
      testRouterFactories: [factory],
      env,
    });
    // A session is verified against the database, so the one issued by the test app is valid here.
    const response = await read(outside.app, id, ana).set('X-Forwarded-Proto', 'https');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'NOT_FOUND' });
    expect(factory).not.toHaveBeenCalled();
    expect(await fixtureRow(id)).toEqual({ name: 'wallet' });
  });
});
