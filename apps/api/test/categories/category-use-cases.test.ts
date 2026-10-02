import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES, defaultCategoryNames } from '@pesly/shared';
import {
  CategoryInUse,
  CategoryNameTaken,
  CategoryNestingTooDeep,
  CategoryParentKindMismatch,
  CreateCategory,
  DeleteCategory,
  EnsureDefaults,
  GetCategory,
  ListCategories,
  SetCategoryArchived,
  UpdateCategory,
  effectiveNames,
  findNameConflict,
} from '../../src/categories';
import { ResourceNotFound } from '../../src/shared/access';
import { FakeCategoryUsage, InMemoryCategoryRepository, writeScopeFor } from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

let categories: InMemoryCategoryRepository;
let usage: FakeCategoryUsage;
let ensureDefaults: EnsureDefaults;
let createCategory: CreateCategory;
let getCategory: GetCategory;
let listCategories: ListCategories;
let updateCategory: UpdateCategory;
let setArchived: SetCategoryArchived;
let deleteCategory: DeleteCategory;

const defaultList = { archived: false, limit: 100, offset: 0 };

beforeEach(() => {
  categories = new InMemoryCategoryRepository();
  usage = new FakeCategoryUsage();
  const deps = { categories, usage };
  ensureDefaults = new EnsureDefaults(deps);
  createCategory = new CreateCategory(deps);
  getCategory = new GetCategory(deps);
  listCategories = new ListCategories(deps);
  updateCategory = new UpdateCategory(deps);
  setArchived = new SetCategoryArchived(deps);
  deleteCategory = new DeleteCategory(deps);
});

async function create(
  userId: string,
  name: string,
  kind: 'expense' | 'income' = 'expense',
  parentId?: string,
) {
  return createCategory.execute(await writeScopeFor(userId), {
    name,
    kind,
    icon: 'wallet',
    color: 'blue',
    ...(parentId === undefined ? {} : { parentId }),
  });
}

async function ids(userId: string, options = defaultList) {
  const page = await listCategories.execute(await writeScopeFor(userId), options);
  return page.items.map((item) => item.id);
}

describe('domain rules', () => {
  it('effectiveNames is the custom name alone, or both languages of an untouched default', () => {
    const base = {
      id: 'x',
      kind: 'expense' as const,
      parentId: null,
      icon: 'wallet' as const,
      color: 'blue' as const,
      archivedAt: null,
      createdAt: new Date(0),
    };
    expect(effectiveNames({ ...base, defaultKey: null, name: 'Mine' })).toEqual(['Mine']);
    expect(effectiveNames({ ...base, defaultKey: 'food', name: 'Mine' })).toEqual(['Mine']);
    expect(effectiveNames({ ...base, defaultKey: 'food', name: null }).sort()).toEqual([
      'Comida',
      'Food',
    ]);
  });

  it('findNameConflict compares NFC lower-cased names and skips the excluded id', () => {
    const sibling = {
      id: 's1',
      kind: 'expense' as const,
      parentId: null,
      defaultKey: null,
      name: 'Ñandú',
      icon: 'wallet' as const,
      color: 'blue' as const,
      archivedAt: null,
      createdAt: new Date(0),
    };
    // Candidate in decomposed form (n + combining tilde) with other casing.
    expect(findNameConflict([sibling], 'ñandú'.normalize('NFD'), null)).toBe(sibling);
    expect(findNameConflict([sibling], 'Ñandú', 's1')).toBeNull();
    expect(findNameConflict([sibling], 'Other', null)).toBeNull();
  });
});

describe('ensureDefaults (AC-22)', () => {
  it('seeds the Appendix A defaults once and never recreates a deleted one', async () => {
    const scope = await writeScopeFor(ALICE);
    await ensureDefaults.execute(scope);
    expect(categories.rows.size).toBe(DEFAULT_CATEGORIES.length);
    expect(categories.seedRuns).toBe(1);

    await ensureDefaults.execute(scope);
    expect(categories.rows.size).toBe(DEFAULT_CATEGORIES.length);
    expect(categories.seedRuns).toBe(1);

    const groceries = categories.byKey(ALICE, 'food.groceries');
    await deleteCategory.execute(scope, groceries.id);
    await ensureDefaults.execute(scope);
    expect(categories.rows.size).toBe(DEFAULT_CATEGORIES.length - 1);
    expect(categories.rows.has(groceries.id)).toBe(false);
  });

  it('every use case calls it first, and a second owner gets their own set', async () => {
    await listCategories.execute(await writeScopeFor(ALICE), defaultList);
    expect(categories.seeded.has(ALICE)).toBe(true);
    await getCategory
      .execute(await writeScopeFor(BOB), (await categoryOf(ALICE)).id)
      .catch(() => undefined);
    expect(categories.seeded.has(BOB)).toBe(true);
    expect(categories.rows.size).toBe(DEFAULT_CATEGORIES.length * 2);
  });

  it('create, update, archive, unarchive and delete seed a fresh owner too', async () => {
    const missing = '99999999-9999-4999-8999-999999999999';
    const calls: Record<
      string,
      (scope: Awaited<ReturnType<typeof writeScopeFor>>) => Promise<unknown>
    > = {
      create: (scope) =>
        createCategory.execute(scope, {
          name: 'Pets',
          kind: 'expense',
          icon: 'wallet',
          color: 'blue',
        }),
      update: (scope) => updateCategory.execute(scope, missing, { name: 'X' }),
      archive: (scope) => setArchived.execute(scope, missing, true),
      unarchive: (scope) => setArchived.execute(scope, missing, false),
      delete: (scope) => deleteCategory.execute(scope, missing),
    };
    for (const [label, call] of Object.entries(calls)) {
      const owner = randomUUID();
      expect(categories.seeded.has(owner), label).toBe(false);
      await call(await writeScopeFor(owner)).catch(() => undefined);
      expect(categories.seeded.has(owner), label).toBe(true);
    }
  });
});

async function categoryOf(userId: string) {
  await ensureDefaults.execute(await writeScopeFor(userId));
  return categories.byKey(userId, 'food');
}

describe('create (AC-02, AC-03, AC-04)', () => {
  it('returns the category and lists it under its kind', async () => {
    const created = await create(ALICE, 'Pets');
    expect(created).toMatchObject({
      name: 'Pets',
      kind: 'expense',
      parentId: null,
      defaultKey: null,
      icon: 'wallet',
      color: 'blue',
      archivedAt: null,
    });
    const scope = await writeScopeFor(ALICE);
    const expense = await listCategories.execute(scope, { ...defaultList, kind: 'expense' });
    expect(expense.items.map((item) => item.id)).toContain(created.id);
    const income = await listCategories.execute(scope, { ...defaultList, kind: 'income' });
    expect(income.items.map((item) => item.id)).not.toContain(created.id);
  });

  it('creates a subcategory under a default parent', async () => {
    const food = await categoryOf(ALICE);
    const child = await create(ALICE, 'Meal prep', 'expense', food.id);
    expect(child.parentId).toBe(food.id);
  });

  it('allows a subcategory under an archived parent (D5)', async () => {
    const food = await categoryOf(ALICE);
    await setArchived.execute(await writeScopeFor(ALICE), food.id, true);
    await expect(create(ALICE, 'Meal prep', 'expense', food.id)).resolves.toMatchObject({
      parentId: food.id,
    });
  });
});

describe('create nesting and kind rules', () => {
  it('a subcategory under a subcategory fails with CategoryNestingTooDeep', async () => {
    await categoryOf(ALICE);
    const groceries = categories.byKey(ALICE, 'food.groceries');
    const attempt = create(ALICE, 'Deep', 'expense', groceries.id);
    await expect(attempt).rejects.toBeInstanceOf(CategoryNestingTooDeep);
    await expect(attempt).rejects.toMatchObject({ code: 'CATEGORY_NESTING_TOO_DEEP' });
  });

  it('a parent of another kind fails with CategoryParentKindMismatch', async () => {
    const food = await categoryOf(ALICE);
    const attempt = create(ALICE, 'Odd', 'income', food.id);
    await expect(attempt).rejects.toBeInstanceOf(CategoryParentKindMismatch);
    await expect(attempt).rejects.toMatchObject({ code: 'CATEGORY_PARENT_KIND_MISMATCH' });
  });
});

describe('update (AC-05)', () => {
  it('persists name, icon and color and returns them', async () => {
    const created = await create(ALICE, 'Old');
    const scope = await writeScopeFor(ALICE);
    const updated = await updateCategory.execute(scope, created.id, {
      name: 'New',
      icon: 'car',
      color: 'red',
    });
    expect(updated).toMatchObject({ name: 'New', icon: 'car', color: 'red', id: created.id });
    expect(await getCategory.execute(scope, created.id)).toMatchObject({
      name: 'New',
      icon: 'car',
      color: 'red',
    });
  });

  it('editing only icon or color keeps an untouched default untouched (D4)', async () => {
    const food = await categoryOf(ALICE);
    const updated = await updateCategory.execute(await writeScopeFor(ALICE), food.id, {
      icon: 'car',
    });
    expect(updated).toMatchObject({ icon: 'car', name: null, defaultKey: 'food' });
  });

  it('changing only the case of its own name is allowed', async () => {
    const created = await create(ALICE, 'Pets');
    await expect(
      updateCategory.execute(await writeScopeFor(ALICE), created.id, { name: 'PETS' }),
    ).resolves.toMatchObject({ name: 'PETS' });
  });
});

describe('archive and unarchive (AC-06, AC-07, AC-08)', () => {
  it('hides the category from the default list, keeps it readable and deletes nothing', async () => {
    const created = await create(ALICE, 'Pets');
    const scope = await writeScopeFor(ALICE);
    const before = categories.rows.size;
    const archived = await setArchived.execute(scope, created.id, true);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(await ids(ALICE)).not.toContain(created.id);
    expect(await ids(ALICE, { ...defaultList, archived: true })).toEqual([created.id]);
    expect((await getCategory.execute(scope, created.id)).id).toBe(created.id);
    expect(categories.rows.size).toBe(before);
  });

  it('archiving a parent archives its subcategories', async () => {
    const food = await categoryOf(ALICE);
    const groceries = categories.byKey(ALICE, 'food.groceries');
    const other = categories.byKey(ALICE, 'transport');
    await setArchived.execute(await writeScopeFor(ALICE), food.id, true);
    const archivedIds = await ids(ALICE, { ...defaultList, archived: true });
    expect(archivedIds).toContain(food.id);
    expect(archivedIds).toContain(groceries.id);
    expect(archivedIds).not.toContain(other.id);
  });

  it('unarchive restores only the target, idempotently, without touching others', async () => {
    const food = await categoryOf(ALICE);
    const groceries = categories.byKey(ALICE, 'food.groceries');
    const scope = await writeScopeFor(ALICE);
    await setArchived.execute(scope, food.id, true);

    const first = await setArchived.execute(scope, food.id, false);
    const second = await setArchived.execute(scope, food.id, false);
    expect(first.archivedAt).toBeNull();
    expect(second.archivedAt).toBeNull();
    expect(await ids(ALICE)).toContain(food.id);
    expect(await ids(ALICE)).not.toContain(groceries.id);
    const stillArchived = await ids(ALICE, { ...defaultList, archived: true });
    expect(stillArchived).toContain(groceries.id);
    expect(stillArchived).not.toContain(food.id);
  });

  it('archiving twice is idempotent and keeps the first archived_at', async () => {
    const created = await create(ALICE, 'Pets');
    const scope = await writeScopeFor(ALICE);
    const first = await setArchived.execute(scope, created.id, true);
    const second = await setArchived.execute(scope, created.id, true);
    expect(second.archivedAt).toEqual(first.archivedAt);
  });

  it('an already archived child keeps its own archived_at when its parent is archived', async () => {
    const food = await categoryOf(ALICE);
    const groceries = categories.byKey(ALICE, 'food.groceries');
    const scope = await writeScopeFor(ALICE);
    const child = await setArchived.execute(scope, groceries.id, true);
    const parent = await setArchived.execute(scope, food.id, true);
    expect(parent.archivedAt).not.toEqual(child.archivedAt);
    const after = await getCategory.execute(scope, groceries.id);
    expect(after.archivedAt).toEqual(child.archivedAt);
    const sibling = categories.rows.get(categories.byKey(ALICE, 'food.restaurants').id);
    expect(sibling?.category.archivedAt).toEqual(parent.archivedAt);
  });
});

describe('defensive branches when a row vanishes in between', () => {
  it('delete returning false is ResourceNotFound', async () => {
    const created = await create(ALICE, 'Pets');
    categories.forceDeleteFalse = true;
    await expect(
      deleteCategory.execute(await writeScopeFor(ALICE), created.id),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });

  it('setArchived returning null is ResourceNotFound', async () => {
    const created = await create(ALICE, 'Pets');
    categories.forceSetArchivedNull = true;
    await expect(
      setArchived.execute(await writeScopeFor(ALICE), created.id, true),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });

  it('updateFields returning null is ResourceNotFound', async () => {
    const created = await create(ALICE, 'Pets');
    categories.forceUpdateFieldsNull = true;
    await expect(
      updateCategory.execute(await writeScopeFor(ALICE), created.id, { icon: 'car' }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });
});

describe('delete (AC-09, AC-10)', () => {
  it('removes a category with no movements and no subcategories', async () => {
    const created = await create(ALICE, 'Pets');
    const scope = await writeScopeFor(ALICE);
    await deleteCategory.execute(scope, created.id);
    expect(categories.rows.has(created.id)).toBe(false);
  });

  it('fails with CategoryInUse when the usage port reports use, and the row stays', async () => {
    const created = await create(ALICE, 'Pets');
    usage.used.add(created.id);
    const attempt = deleteCategory.execute(await writeScopeFor(ALICE), created.id);
    await expect(attempt).rejects.toBeInstanceOf(CategoryInUse);
    await expect(attempt).rejects.toMatchObject({ code: 'CATEGORY_IN_USE' });
    expect(categories.rows.has(created.id)).toBe(true);
  });

  it('fails with CategoryInUse when it has subcategories, and the row stays', async () => {
    const food = await categoryOf(ALICE);
    await expect(
      deleteCategory.execute(await writeScopeFor(ALICE), food.id),
    ).rejects.toBeInstanceOf(CategoryInUse);
    expect(categories.rows.has(food.id)).toBe(true);
  });

  it('a repository foreign-key violation surfaces as CategoryInUse', async () => {
    const created = await create(ALICE, 'Pets');
    categories.deleteError = new CategoryInUse();
    await expect(
      deleteCategory.execute(await writeScopeFor(ALICE), created.id),
    ).rejects.toBeInstanceOf(CategoryInUse);
    expect(categories.rows.has(created.id)).toBe(true);
  });

  it('a failing usage port makes delete fail with its error and keeps the row', async () => {
    const created = await create(ALICE, 'Pets');
    usage.failure = new Error('usage down');
    await expect(deleteCategory.execute(await writeScopeFor(ALICE), created.id)).rejects.toThrow(
      'usage down',
    );
    expect(categories.rows.has(created.id)).toBe(true);
  });
});

describe('name uniqueness (AC-11)', () => {
  it('refuses a duplicate custom name in any case', async () => {
    await create(ALICE, 'Pets');
    await expect(create(ALICE, 'pETS')).rejects.toBeInstanceOf(CategoryNameTaken);
    await expect(create(ALICE, 'pETS')).rejects.toMatchObject({ code: 'CATEGORY_NAME_TAKEN' });
  });

  it('refuses a duplicate among archived siblings too (D7)', async () => {
    const created = await create(ALICE, 'Pets');
    await setArchived.execute(await writeScopeFor(ALICE), created.id, true);
    await expect(create(ALICE, 'Pets')).rejects.toBeInstanceOf(CategoryNameTaken);
  });

  it('refuses the Spanish or English name of an untouched sibling default', async () => {
    await categoryOf(ALICE);
    const names = defaultCategoryNames('transport');
    await expect(create(ALICE, names.es)).rejects.toBeInstanceOf(CategoryNameTaken);
    await expect(create(ALICE, names.en.toUpperCase())).rejects.toBeInstanceOf(CategoryNameTaken);
  });

  it('refuses a rename onto a sibling name, in either language of a default', async () => {
    await categoryOf(ALICE);
    const mine = await create(ALICE, 'Pets');
    const scope = await writeScopeFor(ALICE);
    const names = defaultCategoryNames('transport');
    await expect(updateCategory.execute(scope, mine.id, { name: names.es })).rejects.toBeInstanceOf(
      CategoryNameTaken,
    );
    await expect(updateCategory.execute(scope, mine.id, { name: names.en })).rejects.toBeInstanceOf(
      CategoryNameTaken,
    );
  });

  it('accepts the same name under another parent or kind', async () => {
    const food = await categoryOf(ALICE);
    const transport = categories.byKey(ALICE, 'transport');
    await expect(create(ALICE, 'Extras', 'expense', food.id)).resolves.toBeDefined();
    await expect(create(ALICE, 'Extras', 'expense', transport.id)).resolves.toBeDefined();
    await expect(create(ALICE, 'Extras', 'income')).resolves.toBeDefined();
    await expect(create(ALICE, 'Extras', 'expense')).resolves.toBeDefined();
  });

  it('refuses a decomposed name that equals a composed sibling after NFC', async () => {
    await create(ALICE, 'Ñandú');
    const decomposed = 'ñandú';
    expect(decomposed).not.toBe('ñandú');
    await expect(create(ALICE, decomposed)).rejects.toBeInstanceOf(CategoryNameTaken);
  });

  it('another user may reuse a name', async () => {
    await create(ALICE, 'Pets');
    await expect(create(BOB, 'Pets')).resolves.toMatchObject({ name: 'Pets' });
  });
});

describe('renaming a default (AC-16)', () => {
  it('stores the custom name, keeps the key, and frees the old translations', async () => {
    await categoryOf(ALICE);
    const transport = categories.byKey(ALICE, 'transport');
    const names = defaultCategoryNames('transport');
    const scope = await writeScopeFor(ALICE);

    await expect(create(ALICE, names.en)).rejects.toBeInstanceOf(CategoryNameTaken);

    const renamed = await updateCategory.execute(scope, transport.id, { name: 'Movilidad propia' });
    expect(renamed).toMatchObject({ name: 'Movilidad propia', defaultKey: 'transport' });

    await expect(create(ALICE, names.en)).resolves.toMatchObject({ name: names.en });
    await expect(create(ALICE, names.es)).resolves.toMatchObject({ name: names.es });
    await expect(create(ALICE, 'movilidad PROPIA')).rejects.toBeInstanceOf(CategoryNameTaken);
  });
});

describe('ownership (AC-12, AC-13)', () => {
  it('get, update, archive, unarchive and delete of a foreign id are ResourceNotFound and change nothing', async () => {
    const theirs = await create(BOB, 'Secret');
    const bobRows = () =>
      JSON.stringify([...categories.rows.values()].filter((row) => row.ownerId === BOB));
    const before = bobRows();
    const scope = await writeScopeFor(ALICE);
    await expect(getCategory.execute(scope, theirs.id)).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(updateCategory.execute(scope, theirs.id, { name: 'Mine' })).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(setArchived.execute(scope, theirs.id, true)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(setArchived.execute(scope, theirs.id, false)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(deleteCategory.execute(scope, theirs.id)).rejects.toBeInstanceOf(ResourceNotFound);
    expect(bobRows()).toBe(before);
  });

  it('a missing id is ResourceNotFound too', async () => {
    await expect(
      getCategory.execute(await writeScopeFor(ALICE), '99999999-9999-4999-8999-999999999999'),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });

  it('create with a foreign parent is ResourceNotFound and creates nothing', async () => {
    const theirs = await categoryOf(BOB);
    const before = categories.rows.size;
    await expect(create(ALICE, 'Sneaky', 'expense', theirs.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    // Alice only gained her own defaults.
    expect(categories.rows.size).toBe(before + DEFAULT_CATEGORIES.length);
  });

  it('list returns only the caller categories', async () => {
    const mine = await create(ALICE, 'Mine');
    const theirs = await create(BOB, 'Theirs');
    const aliceIds = await ids(ALICE);
    expect(aliceIds).toContain(mine.id);
    expect(aliceIds).not.toContain(theirs.id);
    const page = await listCategories.execute(await writeScopeFor(ALICE), defaultList);
    expect(page.total).toBe(DEFAULT_CATEGORIES.length + 1);
  });
});

describe('list pagination and filters', () => {
  it('limit and offset slice the same ordered list and total stays the full count', async () => {
    const all = await ids(ALICE);
    const first = await listCategories.execute(await writeScopeFor(ALICE), {
      ...defaultList,
      limit: 5,
    });
    const second = await listCategories.execute(await writeScopeFor(ALICE), {
      ...defaultList,
      limit: 5,
      offset: 5,
    });
    expect(first.items.map((item) => item.id)).toEqual(all.slice(0, 5));
    expect(second.items.map((item) => item.id)).toEqual(all.slice(5, 10));
    expect(first.total).toBe(all.length);
    expect(second.total).toBe(all.length);
    const past = await listCategories.execute(await writeScopeFor(ALICE), {
      ...defaultList,
      offset: all.length,
    });
    expect(past.items).toEqual([]);
  });

  it('kind and archived filters combine', async () => {
    const scope = await writeScopeFor(ALICE);
    const expense = await create(ALICE, 'Pets');
    const income = await create(ALICE, 'Tips', 'income');
    await setArchived.execute(scope, expense.id, true);
    await setArchived.execute(scope, income.id, true);
    const archivedExpense = await listCategories.execute(scope, {
      ...defaultList,
      kind: 'expense',
      archived: true,
    });
    expect(archivedExpense.items.map((item) => item.id)).toEqual([expense.id]);
    expect(archivedExpense.total).toBe(1);
    const archivedIncome = await listCategories.execute(scope, {
      ...defaultList,
      kind: 'income',
      archived: true,
    });
    expect(archivedIncome.items.map((item) => item.id)).toEqual([income.id]);
    const activeIncome = await listCategories.execute(scope, { ...defaultList, kind: 'income' });
    expect(activeIncome.items.map((item) => item.id)).not.toContain(income.id);
    expect(activeIncome.items.every((item) => item.kind === 'income')).toBe(true);
  });
});

describe('list range re-check', () => {
  it('refuses a limit or offset outside the documented range', async () => {
    const scope = await writeScopeFor(ALICE);
    await expect(
      listCategories.execute(scope, { archived: false, limit: 101, offset: 0 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      listCategories.execute(scope, { archived: false, limit: 0, offset: 0 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      listCategories.execute(scope, { archived: false, limit: 10, offset: -1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
