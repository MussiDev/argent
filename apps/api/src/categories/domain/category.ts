import {
  defaultCategoryNames,
  type CategoryColor,
  type CategoryIcon,
  type CategoryKind,
} from '@pesly/shared';

export interface Category {
  id: string;
  kind: CategoryKind;
  /** One level only: a category whose parent has a parent cannot exist. */
  parentId: string | null;
  /** Set for defaults and kept after a rename; null for the user's own categories. */
  defaultKey: string | null;
  /** Null while a default is untouched; the client then shows the translated default name. */
  name: string | null;
  icon: CategoryIcon;
  color: CategoryColor;
  archivedAt: Date | null;
  createdAt: Date;
}

/**
 * The names a category answers to for uniqueness: its custom name alone once set, otherwise both
 * language names of its default key, so uniqueness holds in every interface language.
 */
export function effectiveNames(category: Category): string[] {
  if (category.name !== null) return [category.name];
  if (category.defaultKey === null) return [];
  const names = defaultCategoryNames(category.defaultKey);
  return [names.es, names.en];
}
