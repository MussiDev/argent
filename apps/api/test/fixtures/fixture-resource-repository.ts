import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import type pg from 'pg';
import type { AccessScope } from '../../src/shared/access';
import { scopedTo } from '../../src/shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../src/shared/db/client';

const SCHEMA_FILE = new URL('./fixture-schema.sql', import.meta.url);

/** Creates the fixture tables in the test database (idempotent). Never a production migration. */
export async function applyFixtureSchema(pool: pg.Pool): Promise<void> {
  await pool.query(await readFile(SCHEMA_FILE, 'utf8'));
}

// Mirrors fixture-schema.sql; lives under test/ so drizzle-kit never generates a migration for it.
export const testFixtureResources = pgTable('test_fixture_resources', {
  id: uuid('id').primaryKey(),
  ownerId: uuid('owner_id').notNull(),
  groupId: uuid('group_id'),
  name: text('name').notNull(),
});

export const testFixtureGroupMembers = pgTable(
  'test_fixture_group_members',
  { groupId: uuid('group_id').notNull(), userId: uuid('user_id').notNull() },
  (table) => [primaryKey({ columns: [table.groupId, table.userId] })],
);

export interface FixtureResource {
  id: string;
  name: string;
}

const columns = { id: testFixtureResources.id, name: testFixtureResources.name };

/** The scoped clause every statement uses: this row, and only if the scope covers it. */
function scopedRow(scope: AccessScope, id: string) {
  return and(
    eq(testFixtureResources.id, id),
    scopedTo(scope, { owner: testFixtureResources.ownerId, group: testFixtureResources.groupId }),
  );
}

/**
 * Template for repositories of user data: every method REQUIRES an `AccessScope` (writes a write
 * scope) and is a single
 * statement with the scope in its WHERE clause. "Not found" and "not allowed" are the same
 * outcome (null / false), so callers cannot leak which one it was.
 */
export class FixtureResourceRepository {
  constructor(private readonly db: Database) {}

  async findById(scope: AccessScope, id: string): Promise<FixtureResource | null> {
    const [row] = await this.db
      .select(columns)
      .from(testFixtureResources)
      .where(scopedRow(scope, id))
      .limit(1);
    return row ?? null;
  }

  async rename(
    scope: AccessScope<'write'>,
    id: string,
    name: string,
  ): Promise<FixtureResource | null> {
    const [row] = await this.db
      .update(testFixtureResources)
      .set({ name })
      .where(scopedRow(scope, id))
      .returning(columns);
    return row ?? null;
  }

  async delete(scope: AccessScope<'write'>, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(testFixtureResources)
      .where(scopedRow(scope, id))
      .returning({ id: testFixtureResources.id });
    return rows.length === 1;
  }
}
