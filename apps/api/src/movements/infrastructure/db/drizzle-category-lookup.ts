import { and, eq, sql } from 'drizzle-orm';
import type { CategoryLookup, CategoryReference } from '../../application/ports/category-lookup';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import { categories } from './foreign-relations';

export class DrizzleCategoryLookup implements CategoryLookup {
  constructor(private readonly db: Database) {}

  /** Id, kind and archived state only, filtered by the scope in the same statement. */
  async find(scope: AccessScope, id: string): Promise<CategoryReference | null> {
    const [row] = await this.db
      .select({
        id: categories.id,
        kind: categories.kind,
        archived: sql<boolean>`${categories.archivedAt} is not null`,
      })
      .from(categories)
      .where(and(eq(categories.id, id), scopedTo(scope, { owner: categories.ownerId })))
      .limit(1);
    return row ?? null;
  }
}
