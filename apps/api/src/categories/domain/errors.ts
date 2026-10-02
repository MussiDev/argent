import { AppError } from '@pesly/shared';

/** A sibling (same owner, kind and parent) already answers to this name, in either language. */
export class CategoryNameTaken extends AppError {
  constructor() {
    super('CATEGORY_NAME_TAKEN');
  }
}

/** The category is used by movements or has subcategories, so it can only be archived. */
export class CategoryInUse extends AppError {
  constructor() {
    super('CATEGORY_IN_USE');
  }
}

/** The chosen parent is itself a subcategory. */
export class CategoryNestingTooDeep extends AppError {
  constructor() {
    super('CATEGORY_NESTING_TOO_DEEP');
  }
}

/** The chosen parent has another kind than the new category. */
export class CategoryParentKindMismatch extends AppError {
  constructor() {
    super('CATEGORY_PARENT_KIND_MISMATCH');
  }
}
