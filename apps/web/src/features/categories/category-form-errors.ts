import { CATEGORY_NAME_MAX_LENGTH } from '@pesly/shared';
import type { ErrorMessageKey } from '@/features/auth/form-errors';

export type CategoryFieldName = 'kind' | 'parentId' | 'name' | 'icon' | 'color';

/**
 * Catalog paths of what a field can say: the validation messages live in the `categories`
 * namespace, the answers of the API in `errors` (shared with the other screens).
 */
export type CategoryFieldMessage =
  | 'categories.errors.nameRequired'
  | 'categories.errors.nameTooLong'
  | 'categories.errors.nameInvalidCharacters'
  | 'categories.errors.iconRequired'
  | 'categories.errors.colorRequired'
  | 'categories.errors.kindInvalid'
  | 'categories.errors.parentInvalid'
  | 'errors.categoryNameTaken'
  | 'errors.categoryNestingTooDeep'
  | 'errors.categoryParentKindMismatch';

/** One message above the form and/or one message per field, like the other forms. */
export interface CategoryFormErrors {
  form?: ErrorMessageKey;
  fields?: Partial<Record<CategoryFieldName, CategoryFieldMessage>>;
}

// The same Unicode categories as the shared name validator.
const INVISIBLE_OR_SPACE = /[\p{Cc}\p{Cf}\s]/gu;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

/**
 * Why the shared name schema refused `name`: too many characters, nothing visible, or visible text
 * next to a control or format character.
 */
export function nameErrorMessage(name: string): CategoryFieldMessage {
  const normalized = name.normalize('NFC');
  const trimmed = normalized.trim();
  if (Array.from(trimmed).length > CATEGORY_NAME_MAX_LENGTH) return 'categories.errors.nameTooLong';
  if (trimmed.replace(INVISIBLE_OR_SPACE, '') === '') return 'categories.errors.nameRequired';
  // Checked before trimming, like the shared schema: trim would hide an edge control character.
  return CONTROL_OR_FORMAT.test(normalized)
    ? 'categories.errors.nameInvalidCharacters'
    : 'categories.errors.nameRequired';
}
