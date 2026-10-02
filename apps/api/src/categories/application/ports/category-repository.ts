import type { CategoryColor, CategoryIcon, CategoryKind } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';
import type { Category } from '../../domain/category';

export interface InsertCategoryData {
  kind: CategoryKind;
  parentId: string | null;
  name: string;
  icon: CategoryIcon;
  color: CategoryColor;
}

/** A defined field is written; `name` turns an untouched default into the user's own. */
export interface UpdateCategoryFields {
  name?: string;
  icon?: CategoryIcon;
  color?: CategoryColor;
}

export interface ListCategoriesOptions {
  kind?: CategoryKind;
  /** `false` lists only active rows, `true` only archived ones. */
  archived: boolean;
  limit: number;
  offset: number;
}

/**
 * Transactional view handed to `runExclusive`. Everything in it is already scoped to the owner of
 * the scope `runExclusive` received. Atomic primitives only: the rules run in the use cases.
 */
export interface CategoryTransaction {
  findById(id: string): Promise<Category | null>;
  /** Archived siblings included. */
  listSiblings(kind: CategoryKind, parentId: string | null): Promise<Category[]>;
  insert(data: InsertCategoryData): Promise<Category>;
  /** `null` when the row vanished. */
  updateFields(id: string, fields: UpdateCategoryFields): Promise<Category | null>;
}

/**
 * Every method takes the scope first; a row outside it is indistinguishable from a missing one
 * (`null` / `false`). A foreign-key violation on delete raises `CategoryInUse`.
 */
export interface CategoryRepository {
  /**
   * Safety net: checks the seed marker and seeds the defaults only when it is missing. The same
   * seeding the account-creation hook uses; never recreates a deleted default.
   */
  ensureDefaults(scope: AccessScope<'write'>): Promise<void>;
  findById(scope: AccessScope, id: string): Promise<Category | null>;
  list(
    scope: AccessScope,
    options: ListCategoriesOptions,
  ): Promise<{ items: Category[]; total: number }>;
  /** Idempotent. Archiving also archives the subcategories; unarchiving touches only the target. */
  setArchived(scope: AccessScope<'write'>, id: string, archived: boolean): Promise<Category | null>;
  countChildren(scope: AccessScope, id: string): Promise<number>;
  /** `false` when nothing in scope matched. */
  delete(scope: AccessScope<'write'>, id: string): Promise<boolean>;
  /**
   * Runs `fn` in one transaction holding the per-owner lock that serializes name checks. `fn` must
   * use only the transactional view it receives and never the outer repository methods: those
   * would open a second connection that can deadlock on the advisory lock.
   */
  runExclusive<T>(
    scope: AccessScope<'write'>,
    fn: (tx: CategoryTransaction) => Promise<T>,
  ): Promise<T>;
}
