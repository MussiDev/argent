import {
  DEFAULT_CATEGORIES,
  type CategoryResponse,
  type ListCategoriesResponse,
} from '@pesly/shared';

/** A valid UUID per number: the create schema only accepts UUID parents. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export function category(overrides: Partial<CategoryResponse> = {}): CategoryResponse {
  return {
    id: uuid(900),
    kind: 'expense',
    parentId: null,
    key: null,
    name: 'Mascotas',
    icon: 'paw-print',
    color: 'teal',
    archived: false,
    archivedAt: null,
    createdAt: '2026-10-02T00:00:00.000Z',
    ...overrides,
  };
}

/** The seeded set: every default shares one created_at, as the API stores it. */
export function seededDefaults(): CategoryResponse[] {
  const idByKey = new Map(DEFAULT_CATEGORIES.map((entry, index) => [entry.key, uuid(index + 1)]));
  return DEFAULT_CATEGORIES.map((entry) => ({
    id: idByKey.get(entry.key) ?? '',
    kind: entry.kind,
    parentId: entry.parentKey === null ? null : (idByKey.get(entry.parentKey) ?? null),
    key: entry.key,
    name: null,
    icon: entry.icon,
    color: entry.color,
    archived: false,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
  }));
}

export function defaultRow(key: string, overrides: Partial<CategoryResponse> = {}) {
  const row = seededDefaults().find((candidate) => candidate.key === key);
  if (row === undefined) throw new Error(`No default ${key}`);
  return { ...row, ...overrides };
}

export function page(items: CategoryResponse[], total = items.length, offset = 0) {
  const body: ListCategoriesResponse = { items, total, limit: 100, offset };
  return { status: 200, body };
}
