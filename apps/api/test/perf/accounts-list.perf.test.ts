import { createServer, type Server } from 'node:http';
import autocannon from 'autocannon';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountRoutes } from '../../src/accounts';
import type { AccountMovements } from '../../src/accounts/application/ports/account-movements';
import { createAccountMovements } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { assertIsTestDatabase, testDatabaseUrl } from '../helpers/test-database';
import { ACCOUNTS, expectedBalance, removeDataset, seedDataset } from './movements-seed';

/**
 * NFR-06 benchmark: p95 of the accounts list (limit=100) for one user with 100 accounts whose
 * balances come from 100,000 real movement rows, through the real `createAccountMovements`
 * adapter (ONE `GROUP BY account_id` query per list request). Timing-dependent: run it with
 * `pnpm test:perf`.
 */

const REQUESTS = 500;
const CONNECTIONS = 8;
const MAX_P95_MS = 300;
const PASSWORD = 'a long enough passphrase';
const EMAIL = 'perf-accounts@example.com';

const WARM_UP_REQUESTS = 20;

/** Counts the calls of the real adapter without changing its answers. */
class CountingMovements implements AccountMovements {
  sumsCalls = 0;

  constructor(private readonly inner: AccountMovements) {}

  sumsByAccount(ids: readonly string[]): Promise<ReadonlyMap<string, bigint>> {
    this.sumsCalls += 1;
    return this.inner.sumsByAccount(ids);
  }

  hasMovements(id: string): Promise<boolean> {
    return this.inner.hasMovements(id);
  }
}

let connection: DatabaseConnection;
let moviesPool: pg.Pool;
let server: Server | undefined;
let perfUserId: string | undefined;

beforeAll(() => {
  assertIsTestDatabase(testDatabaseUrl);
  connection = createDatabase(testDatabaseUrl);
  moviesPool = new pg.Pool({ connectionString: testDatabaseUrl, max: CONNECTIONS });
});

afterAll(async () => {
  if (server) {
    const closing = server;
    await new Promise<void>((resolve) => {
      closing.close(() => {
        resolve();
      });
    });
  }
  try {
    assertIsTestDatabase(testDatabaseUrl);
    if (perfUserId) await removeDataset(moviesPool, perfUserId);
  } finally {
    await moviesPool.end();
    await connection.pool.end();
  }
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

interface ListedAccount {
  name: string;
  currency: 'ARS' | 'USD';
  balance: string;
}

describe('accounts list latency (NFR-06)', () => {
  it('keeps p95 of the list below 300 ms for 100 accounts and 100,000 movements', async () => {
    const movements = new CountingMovements(createAccountMovements(connection.db));
    const routes = createAccountRoutes({
      db: connection.db,
      logger: createLogger({ level: 'error', destination: { write: () => undefined } }),
      movements,
    });
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [routes],
    });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    perfUserId = userId;
    const cookies = sessionFrom(await signIn(harness.app, EMAIL, PASSWORD));

    // Seeding failures (including an unreachable database) fail the run: nothing here is caught.
    await seedDataset(moviesPool, userId);

    server = createServer(harness.app);
    const target = server;
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const address = target.address();
    if (!address || typeof address !== 'object') throw new Error('server not listening');
    const url = `http://127.0.0.1:${address.port}`;

    async function load(amount: number) {
      const statuses = new Map<number, number>();
      const latencies: number[] = [];
      await new Promise<void>((resolve, reject) => {
        const instance = autocannon(
          {
            url,
            connections: CONNECTIONS,
            amount,
            timeout: 30,
            requests: [
              {
                method: 'GET',
                path: '/accounts?limit=100',
                headers: { cookie: cookieHeader(cookies) },
              },
            ],
          },
          (error) => {
            if (error) reject(error instanceof Error ? error : new Error(String(error)));
            else resolve();
          },
        );
        instance.on('response', (_client, statusCode, _bytes, responseTime) => {
          statuses.set(statusCode, (statuses.get(statusCode) ?? 0) + 1);
          latencies.push(responseTime);
        });
      });
      return { statuses, latencies };
    }

    // Warm-up (pool connections, planner, JIT) is not measured.
    movements.sumsCalls = 0;
    const warmUp = await load(WARM_UP_REQUESTS);
    expect(Object.fromEntries(warmUp.statuses)).toEqual({ 200: WARM_UP_REQUESTS });
    const { statuses, latencies } = await load(REQUESTS);

    // One list call returns every account with a balance, so the page is the full 100.
    const sample = await fetch(`${url}/accounts?limit=100`, {
      headers: { cookie: cookieHeader(cookies) },
    });
    const body = (await sample.json()) as {
      items: ListedAccount[];
      total: number;
      availableTotals: Record<string, string>;
      netWorthTotals: Record<string, string>;
      debtTotals: Record<string, string>;
      creditCardCount: number;
    };
    expect(body.items).toHaveLength(ACCOUNTS);
    expect(body.total).toBe(ACCOUNTS);

    // Real balances, so an adapter answering with an empty map cannot pass.
    const byName = new Map(body.items.map((item) => [item.name, item]));
    for (const n of [1, 2, 37, 100]) {
      const item = byName.get(`Account ${n}`);
      expect(item?.currency).toBe(n % 2 === 0 ? 'ARS' : 'USD');
      expect(item?.balance).toBe(expectedBalance(n).toString());
    }
    const available = { ARS: 0n, USD: 0n };
    const netWorth = { ARS: 0n, USD: 0n };
    const debt = { ARS: 0n, USD: 0n };
    for (let n = 1; n <= ACCOUNTS; n += 1) {
      const currency = n % 2 === 0 ? 'ARS' : 'USD';
      const balance = expectedBalance(n);
      netWorth[currency] += balance;
      if (n % 10 === 0) debt[currency] += balance;
      else if (n % 4 !== 0) available[currency] += balance;
    }
    const asStrings = (totals: { ARS: bigint; USD: bigint }) => ({
      ARS: totals.ARS.toString(),
      USD: totals.USD.toString(),
    });
    expect(body.availableTotals).toEqual(asStrings(available));
    expect(body.netWorthTotals).toEqual(asStrings(netWorth));
    expect(body.debtTotals).toEqual(asStrings(debt));
    expect(body.creditCardCount).toBe(ACCOUNTS / 10);

    // The balances of the whole page come from one adapter call per list request.
    expect(movements.sumsCalls).toBe(WARM_UP_REQUESTS + REQUESTS + 1);

    const p95 = percentile(latencies, 95);
    console.log(
      `[NFR-06] accounts list: ${latencies.length} requests, p95 = ${p95.toFixed(1)} ms (limit ${MAX_P95_MS} ms)`,
    );
    expect(Object.fromEntries(statuses)).toEqual({ 200: REQUESTS });
    expect(p95).toBeLessThan(MAX_P95_MS);
  }, 180_000);
});
