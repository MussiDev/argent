import { eq, inArray, or, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { assertIssuedScope, type AccessScope } from '../access-policy';

export interface ScopedColumns {
  /** The column holding the owner's user id. */
  owner: AnyPgColumn;
  /** The column holding the group the row is shared through, if the table has one. */
  group?: AnyPgColumn;
}

/**
 * The WHERE predicate of an `AccessScope`: `owner = user` OR `group in (user's groups)`. Combine it
 * with the row filter in the same statement (`and(eq(table.id, id), scopedTo(scope, …))`), so reads
 * and writes are single statements with no check-then-act gap. Throws, before any SQL is built, on
 * a scope that was not issued by an `AccessPolicy`.
 */
export function scopedTo(scope: AccessScope, columns: ScopedColumns): SQL {
  assertIssuedScope(scope);
  const owned = eq(columns.owner, scope.userId);
  if (!columns.group || scope.groupIds.length === 0) return owned;
  return or(owned, inArray(columns.group, [...scope.groupIds])) ?? owned;
}
