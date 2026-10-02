import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { Category } from '../domain/category';
import { EnsureDefaults } from './ensure-defaults';
import type { CategoryRepository } from './ports/category-repository';

export interface GetCategoryDependencies {
  categories: CategoryRepository;
}

export class GetCategory {
  private readonly ensureDefaults: EnsureDefaults;

  constructor(private readonly deps: GetCategoryDependencies) {
    this.ensureDefaults = new EnsureDefaults(deps);
  }

  /** Archived categories stay readable by id. */
  async execute(scope: AccessScope<'write'>, id: string): Promise<Category> {
    await this.ensureDefaults.execute(scope);
    return notFoundUnlessAllowed(await this.deps.categories.findById(scope, id));
  }
}
