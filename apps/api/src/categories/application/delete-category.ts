import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import { CategoryInUse } from '../domain/errors';
import { EnsureDefaults } from './ensure-defaults';
import type { CategoryRepository } from './ports/category-repository';
import type { CategoryUsage } from './ports/category-usage';

export interface DeleteCategoryDependencies {
  categories: CategoryRepository;
  usage: CategoryUsage;
}

export class DeleteCategory {
  private readonly ensureDefaults: EnsureDefaults;

  constructor(private readonly deps: DeleteCategoryDependencies) {
    this.ensureDefaults = new EnsureDefaults(deps);
  }

  /**
   * Missing or foreign: `ResourceNotFound`. Used or with subcategories: `CategoryInUse`, row kept.
   * A foreign-key violation raised by the repository (a movement created in between) propagates
   * as the same error, and a failing usage port propagates its own error.
   */
  async execute(scope: AccessScope<'write'>, id: string): Promise<void> {
    await this.ensureDefaults.execute(scope);
    notFoundUnlessAllowed(await this.deps.categories.findById(scope, id));
    if (await this.deps.usage.isUsed(id)) throw new CategoryInUse();
    if ((await this.deps.categories.countChildren(scope, id)) > 0) throw new CategoryInUse();
    const deleted = await this.deps.categories.delete(scope, id);
    if (!deleted) throw new ResourceNotFound();
  }
}
