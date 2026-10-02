import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError, DEFAULT_CATEGORIES, defaultCategoryNames } from '@pesly/shared';
import type { CategoryIcon } from '@pesly/shared';
import type { CategoryUsage } from '../../src/categories/application/ports/category-usage';
import type { Category } from '../../src/categories/domain/category';
import { CategoryInUse, CategoryNameTaken } from '../../src/categories/domain/errors';
import { findNameConflict } from '../../src/categories/domain/naming';
import { DrizzleCategoryRepository } from '../../src/categories/infrastructure/db/drizzle-category-repository';
import { seedDefaultCategories } from '../../src/categories/infrastructure/db/seed-default-categories';
import { NoUsageAdapter } from '../../src/categories/infrastructure/usage/no-usage-adapter';
import {
  OwnerOrGroupMemberAccessPolicy,
  ResourceNotFound,
  type AccessScope,
} from '../../src/shared/access';
import { DenyAllGroupMembershipReader } from '../../src/shared/access/infrastructure/deny-all-group-membership-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
let categories: DrizzleCategoryRepository;
let collation = '';

const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());

beforeAll(async () => {
  connection = createDatabase(testDatabaseUrl);
  categories = new DrizzleCategoryRepository(connection.db);
  const result = await connection.pool.query<{ datcollate: string }>(
    'select datcollate from pg_database where datname = current_database()',
  );
  collation = result.rows[0]?.datcollate ?? '';
  await connection.pool.query(
    'create table if not exists category_refs_test (id uuid primary key default gen_random_uuid(), category_id uuid not null references categories (id) on delete restrict)',
  );
});

afterAll(async () => {
  await connection.pool.query('drop table if exists category_refs_test');
  await connection.pool.end();
});

function writeScope(userId: string): Promise<AccessScope<'write'>> {
  return policy.scopeFor({ userId, sessionId: 's', emailVerified: true }, 'write');
}

function readScope(userId: string): Promise<AccessScope<'read'>> {
  return policy.scopeFor({ userId, sessionId: 's', emailVerified: true }, 'read');
}

async function newUserId(email: string): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    "insert into users (email, password_hash, time_zone, language) values ($1, 'h', 'UTC', 'es') returning id",
    [email],
  );
  return result.rows[0]?.id ?? '';
}

/** The SQLSTATE code somewhere in the cause chain (drizzle wraps driver errors). */
function sqlStateOf(error: unknown): string | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    const code: unknown = Reflect.get(current, 'code');
    if (typeof code === 'string') return code;
    current = current.cause;
  }
  return undefined;
}

async function sqlState(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return sqlStateOf(error);
  }
}

function query(text: string, values: unknown[] = []): Promise<unknown> {
  return connection.pool.query(text, values);
}

interface RawRow {
  id: string;
  owner_id: string;
  kind: string;
  parent_id: string | null;
  parent_key: string | null;
  default_key: string | null;
  name: string | null;
  icon: string;
  color: string;
  archived_at: Date | null;
  updated_at: Date;
}

async function rawRows(owner: string): Promise<RawRow[]> {
  const result = await connection.pool.query<RawRow>(
    `select c.id, c.owner_id, c.kind, c.parent_id, p.default_key as parent_key, c.default_key, c.name,
            c.icon, c.color, c.archived_at, c.updated_at
       from categories c left join categories p on p.id = c.parent_id
      where c.owner_id = $1
      order by c.default_key nulls last, c.name`,
    [owner],
  );
  return result.rows;
}

async function count(text: string, values: unknown[] = []): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(text, values);
  return Number(result.rows[0]?.n);
}

async function seededUser(email: string): Promise<{ owner: string; scope: AccessScope<'write'> }> {
  const owner = await newUserId(email);
  await seedDefaultCategories(connection.db, owner);
  return { owner, scope: await writeScope(owner) };
}

async function defaultId(owner: string, key: string): Promise<string> {
  const row = (await rawRows(owner)).find((candidate) => candidate.default_key === key);
  if (!row) throw new Error(`default ${key} not found`);
  return row.id;
}

interface RawInsert {
  owner: string;
  kind?: string;
  parent?: string | null;
  key?: string | null;
  name?: string | null;
  icon?: string;
  color?: string;
  createdAt?: string;
}

function rawInsert(fields: RawInsert): Promise<unknown> {
  return query(
    `insert into categories (owner_id, kind, parent_id, default_key, name, icon, color, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()))`,
    [
      fields.owner,
      fields.kind ?? 'expense',
      fields.parent ?? null,
      fields.key ?? null,
      fields.name === undefined ? 'Custom' : fields.name,
      fields.icon ?? 'wallet',
      fields.color ?? 'blue',
      fields.createdAt ?? null,
    ],
  );
}

function create(
  scope: AccessScope<'write'>,
  name: string,
  parentId: string | null = null,
  kind: 'expense' | 'income' = 'expense',
): Promise<Category> {
  return categories.runExclusive(scope, (tx) =>
    tx.insert({ kind, parentId, name, icon: 'wallet', color: 'blue' }),
  );
}

function expectedRows() {
  return DEFAULT_CATEGORIES.map((entry) => ({
    default_key: entry.key,
    kind: entry.kind,
    parent_key: entry.parentKey,
    icon: entry.icon,
    color: entry.color,
    name: null,
  })).sort((a, b) => a.default_key.localeCompare(b.default_key));
}

describe('NoUsageAdapter', () => {
  it('reports every category as unused', async () => {
    const usage: CategoryUsage = new NoUsageAdapter();

    expect(await usage.isUsed('anything')).toBe(false);
  });
});

describe('seedDefaultCategories', () => {
  it('creates the 33 defaults once per owner and writes exactly the live catalog', async () => {
    const owner = await newUserId('ana@example.com');

    await seedDefaultCategories(connection.db, owner);
    await seedDefaultCategories(connection.db, owner);

    const rows = await rawRows(owner);
    expect(rows).toHaveLength(33);
    expect(
      rows
        .map((row) => ({
          default_key: row.default_key,
          kind: row.kind,
          parent_key: row.parent_key,
          icon: row.icon,
          color: row.color,
          name: row.name,
        }))
        .sort((a, b) => (a.default_key ?? '').localeCompare(b.default_key ?? '')),
    ).toEqual(expectedRows());
    expect(rows.every((row) => row.archived_at === null)).toBe(true);
    expect(await count('select count(*) as n from category_defaults_seeded')).toBe(1);
  });

  it('seeds once when called concurrently', async () => {
    const owner = await newUserId('ana@example.com');

    await Promise.all(Array.from({ length: 6 }, () => seedDefaultCategories(connection.db, owner)));

    expect(await rawRows(owner)).toHaveLength(33);
    expect(
      await count('select count(*) as n from category_defaults_seeded where owner_id = $1', [
        owner,
      ]),
    ).toBe(1);
  });

  it('gives a second owner their own set without touching the first', async () => {
    const ana = await newUserId('ana@example.com');
    const bob = await newUserId('bob@example.com');
    await seedDefaultCategories(connection.db, ana);
    const anaBefore = await rawRows(ana);

    await seedDefaultCategories(connection.db, bob);

    expect(await rawRows(bob)).toHaveLength(33);
    expect(await rawRows(ana)).toEqual(anaBefore);
    const bobIds = new Set((await rawRows(bob)).map((row) => row.id));
    expect(anaBefore.some((row) => bobIds.has(row.id))).toBe(false);
    // children point at their own owner's parents
    expect(
      await count(
        'select count(*) as n from categories c join categories p on p.id = c.parent_id where p.owner_id <> c.owner_id',
      ),
    ).toBe(0);
  });

  it('does not recreate a deleted default when seeding again', async () => {
    const { owner, scope } = await seededUser('ana@example.com');
    await categories.delete(scope, await defaultId(owner, 'other-income'));

    await seedDefaultCategories(connection.db, owner);

    expect(await rawRows(owner)).toHaveLength(32);
  });
});

describe('ensureDefaults', () => {
  it('seeds a user without the marker once and never brings back a deleted default', async () => {
    const owner = await newUserId('ana@example.com');
    const scope = await writeScope(owner);

    await categories.ensureDefaults(scope);
    expect(await rawRows(owner)).toHaveLength(33);

    await categories.delete(scope, await defaultId(owner, 'other-income'));
    await categories.ensureDefaults(scope);
    await categories.ensureDefaults(scope);

    const rows = await rawRows(owner);
    expect(rows).toHaveLength(32);
    expect(rows.some((row) => row.default_key === 'other-income')).toBe(false);
  });

  it('seeds concurrent first calls once', async () => {
    const owner = await newUserId('ana@example.com');
    const scope = await writeScope(owner);

    await Promise.all(Array.from({ length: 5 }, () => categories.ensureDefaults(scope)));

    expect(await rawRows(owner)).toHaveLength(33);
  });
});

describe('DrizzleCategoryRepository create, read and update', () => {
  it('creates and reads a category under a default parent', async () => {
    const { owner, scope } = await seededUser('ana@example.com');
    const foodId = await defaultId(owner, 'food');

    const created = await create(scope, 'Panaderia', foodId);

    expect(created).toMatchObject({
      kind: 'expense',
      parentId: foodId,
      defaultKey: null,
      name: 'Panaderia',
      icon: 'wallet',
      color: 'blue',
      archivedAt: null,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await categories.findById(scope, created.id)).toEqual(created);
    expect(await categories.findById(await readScope(owner), created.id)).toEqual(created);
  });

  it('updates name, icon and color and moves updated_at forward', async () => {
    const { owner, scope } = await seededUser('ana@example.com');
    const created = await create(scope, 'Gym');
    await query("update categories set updated_at = '2020-01-01T00:00:00Z' where id = $1", [
      created.id,
    ]);

    const updated = await categories.runExclusive(scope, (tx) =>
      tx.updateFields(created.id, { name: 'Gimnasio', icon: 'dumbbell', color: 'green' }),
    );

    expect(updated).toMatchObject({
      id: created.id,
      name: 'Gimnasio',
      icon: 'dumbbell',
      color: 'green',
    });
    const row = (await rawRows(owner)).find((candidate) => candidate.id === created.id);
    expect(row?.updated_at.getTime()).toBeGreaterThan(Date.parse('2020-01-01T00:00:00Z'));
  });

  it('keeps the key and stores the name when a default is renamed, and keeps the name null for icon edits', async () => {
    const { owner, scope } = await seededUser('ana@example.com');
    const foodId = await defaultId(owner, 'food');
    const fuelId = await defaultId(owner, 'transport.fuel');

    const renamed = await categories.runExclusive(scope, (tx) =>
      tx.updateFields(foodId, { name: 'Comidas' }),
    );
    const recolored = await categories.runExclusive(scope, (tx) =>
      tx.updateFields(fuelId, { icon: 'wrench' satisfies CategoryIcon, color: 'red' }),
    );

    expect(renamed).toMatchObject({ defaultKey: 'food', name: 'Comidas' });
    expect(recolored).toMatchObject({
      defaultKey: 'transport.fuel',
      name: null,
      icon: 'wrench',
      color: 'red',
    });
  });

  it('listSiblings returns the siblings of one kind and parent, archived ones included', async () => {
    const { owner, scope } = await seededUser('ana@example.com');
    const foodId = await defaultId(owner, 'food');
    const gym = await create(scope, 'Gym', foodId);
    await categories.setArchived(scope, gym.id, true);

    const siblings = await categories.runExclusive(scope, (tx) =>
      tx.listSiblings('expense', foodId),
    );
    const roots = await categories.runExclusive(scope, (tx) => tx.listSiblings('income', null));

    expect(siblings.map((sibling) => sibling.defaultKey ?? sibling.name).sort()).toEqual(
      ['food.delivery', 'food.groceries', 'food.restaurants', 'Gym'].sort(),
    );
    expect(roots.map((sibling) => sibling.defaultKey).sort()).toEqual(
      ['freelance', 'gifts-received', 'investment-returns', 'other-income', 'salary'].sort(),
    );
  });

  it('updateFields answers null when the row does not exist for the owner', async () => {
    const { scope } = await seededUser('ana@example.com');

    const result = await categories.runExclusive(scope, (tx) =>
      tx.updateFields('00000000-0000-4000-8000-000000000000', { name: 'Nope' }),
    );

    expect(result).toBeNull();
  });
});

describe('DrizzleCategoryRepository archive', () => {
  it('archives the target and its children, unarchive restores only the target, and the default list excludes archived rows', async () => {
    const { owner, scope } = await seededUser('ana@example.com');
    const foodId = await defaultId(owner, 'food');

    const archived = await categories.setArchived(scope, foodId, true);

    expect(archived?.archivedAt).toBeInstanceOf(Date);
    const archivedRows = (await rawRows(owner)).filter((row) => row.archived_at !== null);
    expect(archivedRows.map((row) => row.default_key).sort()).toEqual(
      ['food', 'food.delivery', 'food.groceries', 'food.restaurants'].sort(),
    );
    const active = await categories.list(scope, { archived: false, limit: 100, offset: 0 });
    expect(active.total).toBe(29);
    expect(active.items.some((item) => item.id === foodId)).toBe(false);
    const onlyArchived = await categories.list(scope, { archived: true, limit: 100, offset: 0 });
    expect(onlyArchived.total).toBe(4);
    expect(await categories.findById(scope, foodId)).toMatchObject({ id: foodId });

    const unarchived = await categories.setArchived(scope, foodId, false);

    expect(unarchived?.archivedAt).toBeNull();
    const stillArchived = (await rawRows(owner)).filter((row) => row.archived_at !== null);
    expect(stillArchived.map((row) => row.default_key).sort()).toEqual(
      ['food.delivery', 'food.groceries', 'food.restaurants'].sort(),
    );
  });

  it('is idempotent and keeps the existing archived_at of rows that were already archived', async () => {
    const { owner, scope } = await seededUser('ana@example.com');
    const foodId = await defaultId(owner, 'food');
    const groceriesId = await defaultId(owner, 'food.groceries');
    await categories.setArchived(scope, groceriesId, true);
    await query("update categories set archived_at = '2021-05-05T00:00:00Z' where id = $1", [
      groceriesId,
    ]);

    const first = await categories.setArchived(scope, foodId, true);
    await query("update categories set archived_at = '2022-06-06T00:00:00Z' where id = $1", [
      foodId,
    ]);
    const second = await categories.setArchived(scope, foodId, true);

    expect(first).not.toBeNull();
    expect(second?.archivedAt?.toISOString()).toBe('2022-06-06T00:00:00.000Z');
    const rows = await rawRows(owner);
    expect(rows.find((row) => row.id === groceriesId)?.archived_at?.toISOString()).toBe(
      '2021-05-05T00:00:00.000Z',
    );
    expect(await categories.setArchived(scope, foodId, false)).not.toBeNull();
    expect((await categories.setArchived(scope, foodId, false))?.archivedAt).toBeNull();
  });
});

describe('DrizzleCategoryRepository delete', () => {
  it('removes an unreferenced leaf and answers false for a missing id', async () => {
    const { scope } = await seededUser('ana@example.com');
    const leaf = await create(scope, 'Gym');

    expect(await categories.countChildren(scope, leaf.id)).toBe(0);
    expect(await categories.delete(scope, leaf.id)).toBe(true);
    expect(await categories.findById(scope, leaf.id)).toBeNull();
    expect(await categories.delete(scope, leaf.id)).toBe(false);
  });

  it('raises CategoryInUse and keeps the row when a referencing row exists (ON DELETE RESTRICT)', async () => {
    const { scope } = await seededUser('ana@example.com');
    const used = await create(scope, 'Used');
    await query('insert into category_refs_test (category_id) values ($1)', [used.id]);

    await expect(categories.delete(scope, used.id)).rejects.toBeInstanceOf(CategoryInUse);

    expect(await categories.findById(scope, used.id)).toEqual(used);
  });

  it('raises CategoryInUse for a parent that still has subcategories and counts them', async () => {
    const { owner, scope } = await seededUser('ana@example.com');
    const foodId = await defaultId(owner, 'food');

    expect(await categories.countChildren(scope, foodId)).toBe(3);
    await expect(categories.delete(scope, foodId)).rejects.toBeInstanceOf(CategoryInUse);
    expect(await categories.findById(scope, foodId)).not.toBeNull();
  });
});

describe('category names', () => {
  it('raises CategoryNameTaken for a duplicate custom name in any case, among roots too', async () => {
    const { owner, scope } = await seededUser('ana@example.com');
    const foodId = await defaultId(owner, 'food');
    await create(scope, 'Gym', foodId);
    await create(scope, 'Pets');

    await expect(create(scope, 'gym', foodId)).rejects.toBeInstanceOf(CategoryNameTaken);
    await expect(create(scope, 'GYM', foodId)).rejects.toBeInstanceOf(CategoryNameTaken);
    await expect(create(scope, 'PETS')).rejects.toBeInstanceOf(CategoryNameTaken);
    expect(await rawRows(owner)).toHaveLength(35);
  });

  it('raises CategoryNameTaken on rename to a sibling name, and archived siblings still count', async () => {
    const { scope } = await seededUser('ana@example.com');
    const first = await create(scope, 'Alpha');
    const second = await create(scope, 'Beta');
    await categories.setArchived(scope, first.id, true);

    await expect(
      categories.runExclusive(scope, (tx) => tx.updateFields(second.id, { name: 'ALPHA' })),
    ).rejects.toBeInstanceOf(CategoryNameTaken);
  });

  it('exposes the Spanish and English names of an untouched sibling default to the conflict rule', async () => {
    const { owner, scope } = await seededUser('ana@example.com');
    const foodId = await defaultId(owner, 'food');
    const names = defaultCategoryNames('food.groceries');

    const siblings = await categories.runExclusive(scope, (tx) =>
      tx.listSiblings('expense', foodId),
    );

    expect(findNameConflict(siblings, names.es, null)?.defaultKey).toBe('food.groceries');
    expect(findNameConflict(siblings, names.en.toUpperCase(), null)?.defaultKey).toBe(
      'food.groceries',
    );
    expect(findNameConflict(siblings, 'Panaderia', null)).toBeNull();
  });

  it('accepts the same name under another parent, kind or as a root', async () => {
    const { owner, scope } = await seededUser('ana@example.com');
    const foodId = await defaultId(owner, 'food');
    const transportId = await defaultId(owner, 'transport');

    await create(scope, 'Gym', foodId);
    await create(scope, 'Gym', transportId);
    await create(scope, 'Gym');
    await create(scope, 'Gym', null, 'income');

    expect(await count("select count(*) as n from categories where name = 'Gym'")).toBe(4);
  });

  it('folds non-ASCII case: Nandu with a tilde conflicts with its lower-case form', async () => {
    const { scope } = await seededUser('ana@example.com');
    const folded = await connection.pool.query<{ folded: string }>(
      "select lower('Ñandú') as folded",
    );
    // lower() follows the database collation; the suite states the one it runs under.
    expect(folded.rows[0]?.folded, `database collation ${collation}`).toBe('ñandú');

    await create(scope, 'Ñandú');

    await expect(create(scope, 'ñandú')).rejects.toBeInstanceOf(CategoryNameTaken);
  });
});

describe('database guards', () => {
  it('rejects raw updates of kind, parent_id, owner_id and default_key and leaves the row unchanged', async () => {
    const { owner, scope } = await seededUser('ana@example.com');
    const other = await newUserId('bob@example.com');
    const foodId = await defaultId(owner, 'food');
    const groceriesId = await defaultId(owner, 'food.groceries');
    const transportId = await defaultId(owner, 'transport');
    const custom = await create(scope, 'Custom');
    const before = await rawRows(owner);

    for (const [statement, id] of [
      ["update categories set kind = 'income' where id = $1", foodId],
      ['update categories set parent_id = null where id = $1', groceriesId],
      [`update categories set parent_id = '${transportId}' where id = $1`, groceriesId],
      [`update categories set parent_id = '${foodId}' where id = $1`, custom.id],
      [`update categories set owner_id = '${other}' where id = $1`, foodId],
      ["update categories set default_key = 'x' where id = $1", foodId],
      ['update categories set default_key = null where id = $1', foodId],
    ] as const) {
      expect(await sqlState(() => query(statement, [id])), statement).toBe('23514');
    }

    expect(await rawRows(owner)).toEqual(before);
    expect(
      await sqlState(() => query("update categories set name = 'X' where id = $1", [foodId])),
    ).toBe(undefined);
  });

  it('rejects a child under a child with 23514', async () => {
    const { owner } = await seededUser('ana@example.com');
    const groceriesId = await defaultId(owner, 'food.groceries');

    expect(await sqlState(() => rawInsert({ owner, parent: groceriesId, name: 'Deep' }))).toBe(
      '23514',
    );
    expect(await count("select count(*) as n from categories where name = 'Deep'")).toBe(0);
  });

  it('rejects a parent of another kind or another owner with 23503', async () => {
    const { owner } = await seededUser('ana@example.com');
    const other = await seededUser('bob@example.com');
    const foodId = await defaultId(owner, 'food');
    const salaryId = await defaultId(owner, 'salary');
    const otherFoodId = await defaultId(other.owner, 'food');

    expect(
      await sqlState(() => rawInsert({ owner, parent: foodId, kind: 'income', name: 'Mixed' })),
    ).toBe('23503');
    expect(await sqlState(() => rawInsert({ owner, parent: otherFoodId, name: 'Stolen' }))).toBe(
      '23503',
    );
    expect(
      await sqlState(() => rawInsert({ owner, parent: salaryId, kind: 'expense', name: 'Mixed2' })),
    ).toBe('23503');
  });

  it('enforces the check constraints', async () => {
    const owner = await newUserId('ana@example.com');

    expect(await sqlState(() => rawInsert({ owner, name: 'x'.repeat(51) }))).toBe('23514');
    expect(await sqlState(() => rawInsert({ owner, name: '' }))).toBe('23514');
    expect(await sqlState(() => rawInsert({ owner, name: null, key: null }))).toBe('23514');
    expect(await sqlState(() => rawInsert({ owner, icon: 'i'.repeat(41) }))).toBe('23514');
    expect(await sqlState(() => rawInsert({ owner, icon: '' }))).toBe('23514');
    expect(await sqlState(() => rawInsert({ owner, color: 'c'.repeat(41) }))).toBe('23514');
    expect(await sqlState(() => rawInsert({ owner, kind: 'other' }))).toBe('23514');
    expect(await sqlState(() => rawInsert({ owner, name: null, key: '' }))).toBe('23514');
    expect(await sqlState(() => rawInsert({ owner, name: null, key: 'k'.repeat(61) }))).toBe(
      '23514',
    );
    expect(await sqlState(() => rawInsert({ owner, name: 'x'.repeat(50) }))).toBeUndefined();
    expect(await sqlState(() => rawInsert({ owner, name: null, key: 'only-key' }))).toBeUndefined();
  });

  it('keeps default keys unique per owner', async () => {
    const { owner } = await seededUser('ana@example.com');

    expect(await sqlState(() => rawInsert({ owner, name: null, key: 'food' }))).toBe('23505');
  });
});

describe('ownership', () => {
  it('answers null, false or zero for every method on another owner id and changes nothing', async () => {
    const ana = await seededUser('ana@example.com');
    const bob = await seededUser('bob@example.com');
    const foodId = await defaultId(ana.owner, 'food');
    const before = await rawRows(ana.owner);

    expect(await categories.findById(bob.scope, foodId)).toBeNull();
    expect(await categories.findById(await readScope(bob.owner), foodId)).toBeNull();
    expect(await categories.setArchived(bob.scope, foodId, true)).toBeNull();
    expect(await categories.setArchived(bob.scope, foodId, false)).toBeNull();
    expect(await categories.countChildren(bob.scope, foodId)).toBe(0);
    expect(await categories.delete(bob.scope, foodId)).toBe(false);
    expect(
      await categories.runExclusive(bob.scope, async (tx) => ({
        found: await tx.findById(foodId),
        updated: await tx.updateFields(foodId, { name: 'Hacked' }),
        siblings: await tx.listSiblings('expense', foodId),
      })),
    ).toEqual({ found: null, updated: null, siblings: [] });

    expect(await rawRows(ana.owner)).toEqual(before);
  });

  it('lists only the caller rows', async () => {
    const ana = await seededUser('ana@example.com');
    const bob = await newUserId('bob@example.com');
    const bobScope = await writeScope(bob);
    await create(bobScope, 'Bobs');

    const anaList = await categories.list(ana.scope, { archived: false, limit: 100, offset: 0 });
    const bobList = await categories.list(bobScope, { archived: false, limit: 100, offset: 0 });

    expect(anaList.total).toBe(33);
    expect(bobList.total).toBe(1);
    expect(bobList.items.map((item) => item.name)).toEqual(['Bobs']);
  });
});

describe('list', () => {
  it('orders by created_at then id, deterministically with identical timestamps, and pages with limit and offset', async () => {
    const owner = await newUserId('ana@example.com');
    const scope = await writeScope(owner);
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      await rawInsert({ owner, name, createdAt: '2026-01-01T00:00:00Z' });
    }
    await rawInsert({ owner, name: 'Earlier', createdAt: '2025-01-01T00:00:00Z' });
    const all = await categories.list(scope, { archived: false, limit: 100, offset: 0 });
    const sameTime = all.items.filter((item) => item.name !== 'Earlier').map((item) => item.id);

    expect(all.total).toBe(6);
    expect(all.items[0]?.name).toBe('Earlier');
    expect(sameTime).toEqual([...sameTime].sort());

    const page1 = await categories.list(scope, { archived: false, limit: 2, offset: 0 });
    const page2 = await categories.list(scope, { archived: false, limit: 2, offset: 2 });
    const page3 = await categories.list(scope, { archived: false, limit: 2, offset: 4 });
    expect([...page1.items, ...page2.items, ...page3.items].map((item) => item.id)).toEqual(
      all.items.map((item) => item.id),
    );
    expect(page1.total).toBe(6);
    expect(page3.items).toHaveLength(2);
  });

  it('honours the kind filter', async () => {
    const { scope } = await seededUser('ana@example.com');

    const income = await categories.list(scope, {
      kind: 'income',
      archived: false,
      limit: 100,
      offset: 0,
    });
    const expense = await categories.list(scope, {
      kind: 'expense',
      archived: false,
      limit: 100,
      offset: 0,
    });

    expect(income.total).toBe(5);
    expect(income.items.every((item) => item.kind === 'income')).toBe(true);
    expect(expense.total).toBe(28);
    expect(income.items.map((item) => item.defaultKey).sort()).toEqual(
      ['freelance', 'gifts-received', 'investment-returns', 'other-income', 'salary'].sort(),
    );
    expect(income.items.every((item) => item.name === null)).toBe(true);
  });
});

describe('runExclusive', () => {
  it('serializes callers of the same owner and lets other owners through', async () => {
    const a = await seededUser('ana@example.com');
    const b = await seededUser('bob@example.com');
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = categories.runExclusive(a.scope, async () => {
      order.push('first-start');
      await gate;
      order.push('first-end');
    });
    while (!order.includes('first-start')) await new Promise((resolve) => setTimeout(resolve, 5));
    const second = categories.runExclusive(a.scope, () => {
      order.push('second-start');
      return Promise.resolve();
    });
    await categories.runExclusive(b.scope, () => {
      order.push('other-owner');
      return Promise.resolve();
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(order).toEqual(['first-start', 'other-owner']);

    release();
    await Promise.all([first, second]);

    expect(order).toEqual(['first-start', 'other-owner', 'first-end', 'second-start']);
  });

  it('rolls everything back when the callback throws', async () => {
    const { owner, scope } = await seededUser('ana@example.com');

    await expect(
      categories.runExclusive(scope, async (tx) => {
        await tx.insert({
          kind: 'expense',
          parentId: null,
          name: 'Ghost',
          icon: 'wallet',
          color: 'blue',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect((await rawRows(owner)).some((row) => row.name === 'Ghost')).toBe(false);
  });

  it('maps a parent deleted concurrently to ResourceNotFound and leaves no row', async () => {
    const { owner, scope } = await seededUser('ana@example.com');
    const parent = await create(scope, 'Parent');

    await expect(
      categories.runExclusive(scope, async (tx) => {
        expect(await tx.findById(parent.id)).not.toBeNull();
        await query('delete from categories where id = $1', [parent.id]);
        return tx.insert({
          kind: 'expense',
          parentId: parent.id,
          name: 'Orphan',
          icon: 'wallet',
          color: 'blue',
        });
      }),
    ).rejects.toBeInstanceOf(ResourceNotFound);

    expect((await rawRows(owner)).some((row) => row.name === 'Orphan')).toBe(false);
  });
});

describe('unexpected errors', () => {
  it('propagates a driver error on insert unchanged instead of mapping it', async () => {
    const { scope } = await seededUser('ana@example.com');

    const failure = await categories
      .runExclusive(scope, (tx) =>
        tx.insert({
          kind: 'expense',
          parentId: null,
          name: 'Long icon',
          icon: 'i'.repeat(41) as CategoryIcon,
          color: 'blue',
        }),
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AppError);
    expect(sqlStateOf(failure)).toBe('23514');
  });

  it('propagates a non-foreign-key driver error on delete unchanged', async () => {
    const { scope } = await seededUser('ana@example.com');

    const failure = await categories.delete(scope, 'not-a-uuid').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AppError);
    expect(sqlStateOf(failure)).toBe('22P02');
  });
});
