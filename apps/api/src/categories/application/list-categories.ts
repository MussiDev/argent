import { AppError, LIST_CATEGORIES_MAX_LIMIT } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { Category } from '../domain/category';
import { EnsureDefaults } from './ensure-defaults';
import type { CategoryRepository, ListCategoriesOptions } from './ports/category-repository';

export interface ListCategoriesDependencies {
  categories: CategoryRepository;
}

export class ListCategories {
  private readonly ensureDefaults: EnsureDefaults;

  constructor(private readonly deps: ListCategoriesDependencies) {
    this.ensureDefaults = new EnsureDefaults(deps);
  }

  /** Needs a write scope because the safety net may seed the owner's defaults first. */
  async execute(
    scope: AccessScope<'write'>,
    options: ListCategoriesOptions,
  ): Promise<{ items: Category[]; total: number }> {
    const { limit, offset } = options;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > LIST_CATEGORIES_MAX_LIMIT ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new AppError('VALIDATION_FAILED', 'limit or offset out of range');
    }
    await this.ensureDefaults.execute(scope);
    return this.deps.categories.list(scope, options);
  }
}
