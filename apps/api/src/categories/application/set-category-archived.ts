import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import type { Category } from '../domain/category';
import { EnsureDefaults } from './ensure-defaults';
import type { CategoryRepository } from './ports/category-repository';

export interface SetCategoryArchivedDependencies {
  categories: CategoryRepository;
}

export class SetCategoryArchived {
  private readonly ensureDefaults: EnsureDefaults;

  constructor(private readonly deps: SetCategoryArchivedDependencies) {
    this.ensureDefaults = new EnsureDefaults(deps);
  }

  /**
   * Archiving also archives the subcategories; unarchiving restores only the target. Both are
   * idempotent.
   */
  async execute(scope: AccessScope<'write'>, id: string, archived: boolean): Promise<Category> {
    await this.ensureDefaults.execute(scope);
    notFoundUnlessAllowed(await this.deps.categories.findById(scope, id));
    const updated = await this.deps.categories.setArchived(scope, id, archived);
    if (updated === null) throw new ResourceNotFound();
    return updated;
  }
}
