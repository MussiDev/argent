import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  OwnerOrGroupMemberAccessPolicy,
  type AccessAction,
  type AccessScope,
} from '../../src/shared/access';
import { scopedTo } from '../../src/shared/access/infrastructure/drizzle-access-scope';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { FixtureGroupMembershipReader } from '../fixtures/fixture-group-membership-reader';
import {
  applyFixtureSchema,
  FixtureResourceRepository,
  testFixtureResources,
} from '../fixtures/fixture-resource-repository';
import { seedUser } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;

beforeAll(async () => {
  connection = createDatabase(testDatabaseUrl);
  await applyFixtureSchema(connection.pool);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';

/** Every SQL statement the repository sends, to prove writes are single scoped statements. */
let statements: string[];
let repository: FixtureResourceRepository;
let policy: OwnerOrGroupMemberAccessPolicy;
let ana: string;
let bob: string;
let carl: string;
let shared: string;
let privateId: string;

async function insertFixture(ownerId: string, name: string, groupId: string | null = null) {
  const id = randomUUID();
  await connection.pool.query(
    'insert into test_fixture_resources (id, owner_id, group_id, name) values ($1, $2, $3, $4)',
    [id, ownerId, groupId, name],
  );
  return id;
}

async function nameOf(id: string): Promise<string | undefined> {
  const result = await connection.pool.query<{ name: string }>(
    'select name from test_fixture_resources where id = $1',
    [id],
  );
  return result.rows[0]?.name;
}

function scope<A extends AccessAction>(userId: string, action: A): Promise<AccessScope<A>> {
  return policy.scopeFor({ userId, sessionId: 'session', emailVerified: true }, action);
}

beforeEach(async () => {
  statements = [];
  repository = new FixtureResourceRepository(
    drizzle({ client: connection.pool, logger: { logQuery: (query) => statements.push(query) } }),
  );
  policy = new OwnerOrGroupMemberAccessPolicy(new FixtureGroupMembershipReader(connection.db));
  ana = await seedUser(connection, { email: 'ana@example.com', password: PASSWORD });
  bob = await seedUser(connection, { email: 'bob@example.com', password: PASSWORD });
  carl = await seedUser(connection, { email: 'carl@example.com', password: PASSWORD });
  const groupId = randomUUID();
  await connection.pool.query(
    'insert into test_fixture_group_members (group_id, user_id) values ($1, $2), ($1, $3)',
    [groupId, ana, bob],
  );
  shared = await insertFixture(ana, 'household', groupId);
  privateId = await insertFixture(ana, 'wallet');
});

describe('FixtureResourceRepository with an AccessScope', () => {
  it('finds rows the read scope covers: own rows and rows shared with a group of the user', async () => {
    expect(await repository.findById(await scope(ana, 'read'), privateId)).toEqual({
      id: privateId,
      name: 'wallet',
    });
    expect(await repository.findById(await scope(bob, 'read'), shared)).toEqual({
      id: shared,
      name: 'household',
    });
  });

  it('returns null, exactly as for a missing id, for rows outside the scope', async () => {
    expect(await repository.findById(await scope(bob, 'read'), privateId)).toBeNull();
    expect(await repository.findById(await scope(carl, 'read'), shared)).toBeNull();
    expect(await repository.findById(await scope(bob, 'write'), shared)).toBeNull();
    expect(await repository.findById(await scope(ana, 'read'), randomUUID())).toBeNull();
  });

  it('puts the scope in the WHERE of a single statement per write', async () => {
    const write = await scope(ana, 'write');
    statements = [];

    expect(await repository.rename(write, privateId, 'savings')).toEqual({
      id: privateId,
      name: 'savings',
    });
    expect(await repository.delete(write, shared)).toBe(true);

    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement).toMatch(/where .*"id" = \$\d+ and .*"owner_id" = \$\d+/);
    }
    expect(await nameOf(privateId)).toBe('savings');
    expect(await nameOf(shared)).toBeUndefined();
  });

  it('only accepts a write scope in write methods (compile time)', async () => {
    const read = await scope(ana, 'read');
    // Never called: the point is that these lines only compile with the directive.
    const misuse = () => [
      // @ts-expect-error A read scope cannot be passed to a write method.
      repository.rename(read, privateId, 'hacked'),
      // @ts-expect-error Nor to delete.
      repository.delete(read, privateId),
    ];
    expect(typeof misuse).toBe('function');
    expect(await nameOf(privateId)).toBe('wallet');
  });

  it('refuses a forged scope at run time before any SQL is sent', async () => {
    const read = await scope(ana, 'read');
    // Casts stand for code that bypasses the type system; the run-time brand check still holds.
    // eslint-disable-next-line @typescript-eslint/no-misused-spread -- forging a scope on purpose
    const forged = { ...read, userId: bob } as unknown as AccessScope<'read'>;
    statements = [];

    await expect(repository.findById(forged, privateId)).rejects.toThrow(
      'AccessScope was not issued by an AccessPolicy',
    );
    expect(() => scopedTo(forged, { owner: testFixtureResources.ownerId })).toThrow(
      'AccessScope was not issued by an AccessPolicy',
    );
    expect(statements).toEqual([]);
  });

  it('changes nothing and reports a miss when the write scope does not cover the row', async () => {
    for (const userId of [bob, carl]) {
      const write = await scope(userId, 'write');
      expect(await repository.rename(write, shared, 'hacked')).toBeNull();
      expect(await repository.rename(write, privateId, 'hacked')).toBeNull();
      expect(await repository.delete(write, shared)).toBe(false);
      expect(await repository.delete(write, privateId)).toBe(false);
    }
    expect(await nameOf(shared)).toBe('household');
    expect(await nameOf(privateId)).toBe('wallet');
  });
});
