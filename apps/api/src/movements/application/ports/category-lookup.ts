import type { CategoryKind } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';

export interface CategoryReference {
  id: string;
  kind: CategoryKind;
  archived: boolean;
}

/** `null` when the category is missing or outside the scope. */
export interface CategoryLookup {
  find(scope: AccessScope, id: string): Promise<CategoryReference | null>;
}
