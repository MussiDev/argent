import { DEFAULT_CATEGORIES } from '@pesly/shared';
import { sql } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';

/**
 * A database handle or a transaction on it. Declared here, structurally, so the account-creation
 * hook can pass its transaction without categories importing identity internals.
 */
export type SeedDatabase = PgDatabase<NodePgQueryResultHKT>;

// Explicit casts: untyped parameters in a VALUES list are not guaranteed to resolve to text.
const DEFAULT_ROWS = sql.join(
  DEFAULT_CATEGORIES.map(
    (entry) =>
      sql`(${entry.key}::text, ${entry.kind}::text, ${entry.parentKey}::text, ${entry.icon}::text, ${entry.color}::text)`,
  ),
  sql`, `,
);

/**
 * Creates the default set for `userId` in ONE statement: the marker `on conflict do nothing
 * returning`, then the roots, then the children joined to them by key. Only the caller that wrote
 * the marker inserts rows, so concurrent callers seed once and a deleted default never returns.
 * It takes the transaction of the caller, so account creation and its defaults commit together.
 */
export async function seedDefaultCategories(tx: SeedDatabase, userId: string): Promise<void> {
  await tx.execute(sql`
    with "defaults" ("key", "kind", "parent_key", "icon", "color") as (
      values ${DEFAULT_ROWS}
    ), "new_owner" as (
      insert into "category_defaults_seeded" ("owner_id") values (${userId}::uuid)
      on conflict ("owner_id") do nothing
      returning "owner_id"
    ), "roots" as (
      insert into "categories" ("owner_id", "kind", "default_key", "icon", "color")
      select "new_owner"."owner_id", "defaults"."kind", "defaults"."key", "defaults"."icon", "defaults"."color"
      from "new_owner" cross join "defaults"
      where "defaults"."parent_key" is null
      returning "id", "owner_id", "default_key"
    )
    insert into "categories" ("owner_id", "kind", "parent_id", "default_key", "icon", "color")
    select "roots"."owner_id", "defaults"."kind", "roots"."id", "defaults"."key", "defaults"."icon", "defaults"."color"
    from "defaults" join "roots" on "roots"."default_key" = "defaults"."parent_key"
  `);
}
