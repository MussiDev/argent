import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import type { Category } from '../domain/category';
import { CategoryNameTaken } from '../domain/errors';
import { findNameConflict } from '../domain/naming';
import { EnsureDefaults } from './ensure-defaults';
import type { CategoryRepository, UpdateCategoryFields } from './ports/category-repository';

export interface UpdateCategoryDependencies {
  categories: CategoryRepository;
}

export class UpdateCategory {
  private readonly ensureDefaults: EnsureDefaults;

  constructor(private readonly deps: UpdateCategoryDependencies) {
    this.ensureDefaults = new EnsureDefaults(deps);
  }

  /**
   * A name change on a default stores the custom name and keeps its key, so it stops translating
   * (D4: icon and color changes do not).
   */
  async execute(
    scope: AccessScope<'write'>,
    id: string,
    fields: UpdateCategoryFields,
  ): Promise<Category> {
    await this.ensureDefaults.execute(scope);
    return this.deps.categories.runExclusive(scope, async (tx) => {
      const current = notFoundUnlessAllowed(await tx.findById(id));
      if (fields.name !== undefined) {
        const siblings = await tx.listSiblings(current.kind, current.parentId);
        if (findNameConflict(siblings, fields.name, current.id) !== null) {
          throw new CategoryNameTaken();
        }
      }
      const updated = await tx.updateFields(id, fields);
      if (updated === null) throw new ResourceNotFound();
      return updated;
    });
  }
}
