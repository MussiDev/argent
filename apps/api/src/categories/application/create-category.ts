import type { CategoryColor, CategoryIcon, CategoryKind } from '@pesly/shared';
import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { Category } from '../domain/category';
import {
  CategoryNameTaken,
  CategoryNestingTooDeep,
  CategoryParentKindMismatch,
} from '../domain/errors';
import { findNameConflict } from '../domain/naming';
import { EnsureDefaults } from './ensure-defaults';
import type { CategoryRepository } from './ports/category-repository';

export interface CreateCategoryDependencies {
  categories: CategoryRepository;
}

export interface CreateCategoryData {
  name: string;
  kind: CategoryKind;
  icon: CategoryIcon;
  color: CategoryColor;
  parentId?: string;
}

export class CreateCategory {
  private readonly ensureDefaults: EnsureDefaults;

  constructor(private readonly deps: CreateCategoryDependencies) {
    this.ensureDefaults = new EnsureDefaults(deps);
  }

  /**
   * `data` is already parsed. The parent is loaded inside the exclusive section, so a foreign,
   * missing or concurrently deleted parent is `ResourceNotFound`.
   */
  async execute(scope: AccessScope<'write'>, data: CreateCategoryData): Promise<Category> {
    await this.ensureDefaults.execute(scope);
    return this.deps.categories.runExclusive(scope, async (tx) => {
      const parentId = data.parentId ?? null;
      if (parentId !== null) {
        const parent = notFoundUnlessAllowed(await tx.findById(parentId));
        if (parent.parentId !== null) throw new CategoryNestingTooDeep();
        if (parent.kind !== data.kind) throw new CategoryParentKindMismatch();
      }
      const siblings = await tx.listSiblings(data.kind, parentId);
      if (findNameConflict(siblings, data.name, null) !== null) throw new CategoryNameTaken();
      return tx.insert({
        kind: data.kind,
        parentId,
        name: data.name,
        icon: data.icon,
        color: data.color,
      });
    });
  }
}
