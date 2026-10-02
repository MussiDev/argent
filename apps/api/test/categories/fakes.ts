import { randomUUID } from 'node:crypto';
import { DEFAULT_CATEGORIES, type CategoryKind } from '@pesly/shared';
import type { Category } from '../../src/categories/domain/category';
import type {
  CategoryRepository,
  CategoryTransaction,
  InsertCategoryData,
  ListCategoriesOptions,
  UpdateCategoryFields,
} from '../../src/categories/application/ports/category-repository';
import type { CategoryUsage } from '../../src/categories/application/ports/category-usage';
import { OwnerOrGroupMemberAccessPolicy, type AccessScope } from '../../src/shared/access';
import { DenyAllGroupMembershipReader } from '../../src/shared/access/infrastructure/deny-all-group-membership-reader';

const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());

export function writeScopeFor(userId: string): Promise<AccessScope<'write'>> {
  return policy.scopeFor({ userId, sessionId: 'session', emailVerified: true }, 'write');
}

interface Row {
  ownerId: string;
  category: Category;
}

/**
 * In-memory repository. It implements only the atomic primitives: the name rule and the nesting
 * rules run in the use cases, so the tests exercise production code. Rows are visible only to
 * their owner.
 */
export class InMemoryCategoryRepository implements CategoryRepository {
  readonly rows = new Map<string, Row>();
  /** Owners whose defaults were seeded (the marker). */
  readonly seeded = new Set<string>();
  /** Number of times the seeding statement actually inserted the defaults. */
  seedRuns = 0;
  /** When set, `delete` throws it, like the database foreign-key backstop does. */
  deleteError: Error | null = null;
  /** Force the defensive "the row vanished in between" outcomes of the primitives. */
  forceDeleteFalse = false;
  forceSetArchivedNull = false;
  forceUpdateFieldsNull = false;
  private clock = 0;

  async ensureDefaults(scope: AccessScope<'write'>): Promise<void> {
    await Promise.resolve();
    if (this.seeded.has(scope.userId)) return;
    this.seeded.add(scope.userId);
    this.seedRuns += 1;
    const idByKey = new Map<string, string>();
    for (const entry of DEFAULT_CATEGORIES) {
      const id = randomUUID();
      idByKey.set(entry.key, id);
      let parentId: string | null = null;
      if (entry.parentKey !== null) {
        parentId = idByKey.get(entry.parentKey) ?? null;
        if (parentId === null) throw new Error(`Default ${entry.key} listed before its parent`);
      }
      this.rows.set(id, {
        ownerId: scope.userId,
        category: {
          id,
          kind: entry.kind,
          parentId,
          defaultKey: entry.key,
          name: null,
          icon: entry.icon,
          color: entry.color,
          archivedAt: null,
          createdAt: this.tick(),
        },
      });
    }
  }

  async findById(scope: AccessScope, id: string): Promise<Category | null> {
    await Promise.resolve();
    return this.visible(scope.userId, id)?.category ?? null;
  }

  async list(
    scope: AccessScope,
    options: ListCategoriesOptions,
  ): Promise<{ items: Category[]; total: number }> {
    await Promise.resolve();
    const matching = this.ownedBy(scope.userId).filter(
      (category) =>
        (category.archivedAt !== null) === options.archived &&
        (options.kind === undefined || category.kind === options.kind),
    );
    return {
      items: matching.slice(options.offset, options.offset + options.limit),
      total: matching.length,
    };
  }

  async setArchived(
    scope: AccessScope<'write'>,
    id: string,
    archived: boolean,
  ): Promise<Category | null> {
    await Promise.resolve();
    if (this.forceSetArchivedNull) return null;
    const row = this.visible(scope.userId, id);
    if (!row) return null;
    // Ticking clock: each archive operation gets its own instant, so a kept archived_at is visible.
    const stamp = this.tick();
    const apply = (target: Row, value: boolean): void => {
      if (value === (target.category.archivedAt !== null)) return;
      target.category = { ...target.category, archivedAt: value ? stamp : null };
    };
    apply(row, archived);
    if (archived) {
      for (const child of this.rows.values()) {
        if (child.ownerId === scope.userId && child.category.parentId === id) apply(child, true);
      }
    }
    return row.category;
  }

  async countChildren(scope: AccessScope, id: string): Promise<number> {
    await Promise.resolve();
    return this.ownedBy(scope.userId).filter((category) => category.parentId === id).length;
  }

  async delete(scope: AccessScope<'write'>, id: string): Promise<boolean> {
    await Promise.resolve();
    if (this.deleteError) throw this.deleteError;
    if (this.forceDeleteFalse) return false;
    if (!this.visible(scope.userId, id)) return false;
    this.rows.delete(id);
    return true;
  }

  /** Trivial: no real transaction, the tests are sequential. */
  async runExclusive<T>(
    scope: AccessScope<'write'>,
    fn: (tx: CategoryTransaction) => Promise<T>,
  ): Promise<T> {
    const ownerId = scope.userId;
    const tx: CategoryTransaction = {
      findById: async (id) => {
        await Promise.resolve();
        return this.visible(ownerId, id)?.category ?? null;
      },
      listSiblings: async (kind: CategoryKind, parentId: string | null) => {
        await Promise.resolve();
        return this.ownedBy(ownerId).filter(
          (category) => category.kind === kind && category.parentId === parentId,
        );
      },
      insert: async (data: InsertCategoryData) => {
        await Promise.resolve();
        const category: Category = {
          id: randomUUID(),
          kind: data.kind,
          parentId: data.parentId,
          defaultKey: null,
          name: data.name,
          icon: data.icon,
          color: data.color,
          archivedAt: null,
          createdAt: this.tick(),
        };
        this.rows.set(category.id, { ownerId, category });
        return category;
      },
      updateFields: async (id: string, fields: UpdateCategoryFields) => {
        await Promise.resolve();
        if (this.forceUpdateFieldsNull) return null;
        const row = this.visible(ownerId, id);
        if (!row) return null;
        row.category = {
          ...row.category,
          ...(fields.name !== undefined ? { name: fields.name } : {}),
          ...(fields.icon !== undefined ? { icon: fields.icon } : {}),
          ...(fields.color !== undefined ? { color: fields.color } : {}),
        };
        return row.category;
      },
    };
    return fn(tx);
  }

  /** Test helper: the default of an owner by its key. */
  byKey(ownerId: string, key: string): Category {
    const found = this.ownedBy(ownerId).find((category) => category.defaultKey === key);
    if (!found) throw new Error(`No default ${key} for ${ownerId}`);
    return found;
  }

  private tick(): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock++));
  }

  private visible(ownerId: string, id: string): Row | undefined {
    const row = this.rows.get(id);
    return row && row.ownerId === ownerId ? row : undefined;
  }

  private ownedBy(ownerId: string): Category[] {
    return [...this.rows.values()]
      .filter((row) => row.ownerId === ownerId)
      .map((row) => row.category)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
}

/** Configurable usage port: a set of "used" ids, or a failure. */
export class FakeCategoryUsage implements CategoryUsage {
  readonly used = new Set<string>();
  failure: Error | null = null;

  async isUsed(categoryId: string): Promise<boolean> {
    await Promise.resolve();
    if (this.failure) throw this.failure;
    return this.used.has(categoryId);
  }
}
