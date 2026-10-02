import { randomUUID } from 'node:crypto';
import { accountResponseSchema } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newCategory } from './db-fixtures';
import {
  get,
  movementBody,
  obligationsSetup,
  send,
  type ObligationsSetup,
} from './obligations-harness';

/** FEAT-003 Available and Net worth totals with real movements (spec 03b, Block 7). */

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

interface Totals {
  available: bigint;
  netWorth: bigint;
}

async function totals(s: ObligationsSetup, cookies = s.ana): Promise<Totals> {
  const response = await get(s.app, '/accounts?limit=100', cookies);
  expect(response.status).toBe(200);
  const body = response.body as {
    availableTotals: { ARS: string };
    netWorthTotals: { ARS: string };
  };
  return {
    available: BigInt(body.availableTotals.ARS),
    netWorth: BigInt(body.netWorthTotals.ARS),
  };
}

async function createAccount(
  s: ObligationsSetup,
  includeInAvailable: boolean,
  openingBalance: string,
): Promise<string> {
  const response = await send(s.app, 'post', '/accounts', s.ana, {
    name: `Cuenta ${randomUUID()}`,
    type: 'cash',
    currency: 'ARS',
    openingBalance,
    includeInAvailable,
  });
  expect(response.status).toBe(201);
  return accountResponseSchema.parse(response.body).id;
}

async function record(
  s: ObligationsSetup,
  type: 'expense' | 'income',
  accountId: string,
  categoryId: string,
  amount: string,
  cookies = s.ana,
): Promise<void> {
  const response = await send(
    s.app,
    'post',
    '/movements',
    cookies,
    movementBody({ type, accountId, categoryId, amount }),
  );
  expect(response.status).toBe(201);
}

describe('Available and Net worth with real movements', () => {
  it('an expense of 100.00 lowers both, an income raises both, a non-included account moves only Net worth (AC-24, AC-12, AC-13)', async () => {
    const s = await obligationsSetup(connection);
    const included = await createAccount(s, true, '50000');
    const excluded = await createAccount(s, false, '20000');
    const expense = await newCategory(connection.pool, s.anaId, 'expense');
    const income = await newCategory(connection.pool, s.anaId, 'income');
    expect(await totals(s)).toEqual({ available: 50000n, netWorth: 70000n });

    await record(s, 'expense', included, expense, '10000');
    expect(await totals(s)).toEqual({ available: 40000n, netWorth: 60000n });

    await record(s, 'income', included, income, '25000');
    expect(await totals(s)).toEqual({ available: 65000n, netWorth: 85000n });

    await record(s, 'expense', excluded, expense, '10000');
    expect(await totals(s)).toEqual({ available: 65000n, netWorth: 75000n });

    await record(s, 'income', excluded, income, '3000');
    expect(await totals(s)).toEqual({ available: 65000n, netWorth: 78000n });
  });

  it("a second user's movements never change the caller's totals (AC-13)", async () => {
    const s = await obligationsSetup(connection);
    await createAccount(s, true, '1000');
    const bobAccountResponse = await send(s.app, 'post', '/accounts', s.bob, {
      name: 'Bob',
      type: 'cash',
      currency: 'ARS',
      openingBalance: '0',
    });
    const bobAccount = accountResponseSchema.parse(bobAccountResponse.body).id;
    const bobCategory = await newCategory(connection.pool, s.bobId, 'income');
    const before = await totals(s);

    await record(s, 'income', bobAccount, bobCategory, '777777', s.bob);

    expect(await totals(s)).toEqual(before);
    expect(before).toEqual({ available: 1000n, netWorth: 1000n });
  });
});
