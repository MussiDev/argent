import type { CategoryResponse, ListCategoriesResponse } from '@pesly/shared';
import type { Category } from '../../domain/category';

/** The only place where dates become ISO strings; `key` stays for defaults, `name` is null while untouched. */
export function presentCategory(category: Category): CategoryResponse {
  return {
    id: category.id,
    kind: category.kind,
    parentId: category.parentId,
    key: category.defaultKey,
    name: category.name,
    icon: category.icon,
    color: category.color,
    archived: category.archivedAt !== null,
    archivedAt: category.archivedAt?.toISOString() ?? null,
    createdAt: category.createdAt.toISOString(),
  };
}

export function presentCategoryList(
  list: { items: Category[]; total: number },
  page: { limit: number; offset: number },
): ListCategoriesResponse {
  return {
    items: list.items.map(presentCategory),
    total: list.total,
    limit: page.limit,
    offset: page.offset,
  };
}
