import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountMovements } from '../../src/movements/infrastructure/accounts/drizzle-account-movements';
import { createCategoryUsage } from '../../src/movements/infrastructure/categories/drizzle-category-usage';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newMovement, newUserId } from './db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

async function ownerSetup() {
  const ownerId = await newUserId(connection.db);
  const expense = await newCategory(connection.pool, ownerId, 'expense');
  const income = await newCategory(connection.pool, ownerId, 'income');
  return { ownerId, expense, income };
}

describe('createAccountMovements', () => {
  it('returns income minus expense per account and omits accounts without movements', async () => {
    const { ownerId, expense, income } = await ownerSetup();
    const a = await newAccount(connection.pool, ownerId);
    const b = await newAccount(connection.pool, ownerId);
    const empty = await newAccount(connection.pool, ownerId);
    const base = { ownerId, categoryId: expense };
    await newMovement(connection.pool, { ...base, accountId: a, type: 'expense', amount: 300n });
    await newMovement(connection.pool, {
      ...base,
      accountId: a,
      categoryId: income,
      type: 'income',
      amount: 1_000n,
    });
    await newMovement(connection.pool, { ...base, accountId: b, type: 'expense', amount: 50n });
    const sums = await createAccountMovements(connection.db).sumsByAccount([a, b, empty]);
    expect(sums.get(a)).toBe(700n);
    expect(sums.get(b)).toBe(-50n);
    expect(sums.has(empty)).toBe(false);
  });

  it('keeps sums exact above the safe integer range', async () => {
    const { ownerId, expense } = await ownerSetup();
    const a = await newAccount(connection.pool, ownerId);
    const big = 999_999_999_999_999n;
    for (let i = 0; i < 3; i += 1) {
      await newMovement(connection.pool, {
        ownerId,
        accountId: a,
        categoryId: expense,
        type: 'expense',
        amount: big,
      });
    }
    const sums = await createAccountMovements(connection.db).sumsByAccount([a]);
    expect(sums.get(a)).toBe(-3n * big);
  });

  it('returns an empty map for no ids', async () => {
    expect((await createAccountMovements(connection.db).sumsByAccount([])).size).toBe(0);
  });

  it('handles more than 500 ids in sequential chunks', async () => {
    const { ownerId, expense } = await ownerSetup();
    const first = await newAccount(connection.pool, ownerId);
    const last = await newAccount(connection.pool, ownerId);
    for (const [accountId, amount] of [
      [first, 7n],
      [last, 9n],
    ] as const) {
      await newMovement(connection.pool, {
        ownerId,
        accountId,
        categoryId: expense,
        type: 'expense',
        amount,
      });
    }
    const ids: string[] = Array.from({ length: 1200 }, () => randomUUID());
    ids[3] = first;
    ids[1100] = last;
    const sums = await createAccountMovements(connection.db).sumsByAccount(ids);
    expect(sums.size).toBe(2);
    expect(sums.get(first)).toBe(-7n);
    expect(sums.get(last)).toBe(-9n);
  });

  it('ignores accounts that were not asked for and other users', async () => {
    const first = await ownerSetup();
    const second = await ownerSetup();
    const mine = await newAccount(connection.pool, first.ownerId);
    const notAsked = await newAccount(connection.pool, first.ownerId);
    const theirs = await newAccount(connection.pool, second.ownerId);
    for (const [ownerId, accountId, categoryId] of [
      [first.ownerId, mine, first.expense],
      [first.ownerId, notAsked, first.expense],
      [second.ownerId, theirs, second.expense],
    ] as const) {
      await newMovement(connection.pool, {
        ownerId,
        accountId,
        categoryId,
        type: 'expense',
        amount: 10n,
      });
    }
    const sums = await createAccountMovements(connection.db).sumsByAccount([mine]);
    expect([...sums.keys()]).toEqual([mine]);
  });

  it('hasMovements is false before the first movement and true after', async () => {
    const { ownerId, expense } = await ownerSetup();
    const a = await newAccount(connection.pool, ownerId);
    const adapter = createAccountMovements(connection.db);
    expect(await adapter.hasMovements(a)).toBe(false);
    await newMovement(connection.pool, {
      ownerId,
      accountId: a,
      categoryId: expense,
      type: 'expense',
      amount: 1n,
    });
    expect(await adapter.hasMovements(a)).toBe(true);
  });
});

describe('createCategoryUsage', () => {
  it('isUsed is false before the first movement and true after', async () => {
    const { ownerId, expense } = await ownerSetup();
    const a = await newAccount(connection.pool, ownerId);
    const usage = createCategoryUsage(connection.db);
    expect(await usage.isUsed(expense)).toBe(false);
    await newMovement(connection.pool, {
      ownerId,
      accountId: a,
      categoryId: expense,
      type: 'expense',
      amount: 1n,
    });
    expect(await usage.isUsed(expense)).toBe(true);
  });
});
