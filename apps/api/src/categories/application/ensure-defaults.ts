import type { AccessScope } from '../../shared/access';
import type { CategoryRepository } from './ports/category-repository';

export interface EnsureDefaultsDependencies {
  categories: CategoryRepository;
}

/** The D9 safety net: seeds only when the owner's marker is missing. */
export class EnsureDefaults {
  constructor(private readonly deps: EnsureDefaultsDependencies) {}

  async execute(scope: AccessScope<'write'>): Promise<void> {
    await this.deps.categories.ensureDefaults(scope);
  }
}
