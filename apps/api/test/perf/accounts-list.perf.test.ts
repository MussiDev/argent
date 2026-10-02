import { createServer, type Server } from 'node:http';
import autocannon from 'autocannon';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountRoutes } from '../../src/accounts';
import type { AccountMovements } from '../../src/accounts/application/ports/account-movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { assertIsTestDatabase, testDatabaseUrl } from '../helpers/test-database';

/**
 * NFR-02 benchmark: p95 of the accounts list (limit=100) for one user with 100 accounts whose
 * balances come from 100,000 movement rows. PRD 03 owns the real movements table, so this test
 * creates a test-only `perf_movements` table (never a migration) and injects an adapter that
 * answers with ONE `GROUP BY account_id` query. Timing-dependent: run it with `pnpm test:perf`.
 */

const ACCOUNTS = 100;
const MOVEMENTS = 100_000;
const REQUESTS = 500;
const CONNECTIONS = 8;
const MAX_P95_MS = 300;
const PASSWORD = 'a long enough passphrase';
const EMAIL = 'perf-accounts@example.com';

const WARM_UP_REQUESTS = 20;

class SqlMovements implements AccountMovements {
  sumsCalls = 0;

  constructor(private readonly pool: pg.Pool) {}

  async sumsByAccount(ids: readonly string[]): Promise<ReadonlyMap<string, bigint>> {
    this.sumsCalls += 1;
    const { rows } = await this.pool.query<{ account_id: string; total: string }>(
      `select account_id, sum(amount)::text as total
         from perf_movements
        where account_id = any($1::uuid[])
        group by account_id`,
      [ids],
    );
    return new Map(rows.map((row) => [row.account_id, BigInt(row.total)]));
  }

  async hasMovements(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'select 1 from perf_movements where account_id = $1 limit 1',
      [id],
    );
    return (rowCount ?? 0) > 0;
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
    await moviesPool.query('drop table if exists perf_movements');
    if (perfUserId) {
      await moviesPool.query('delete from accounts where owner_id = $1', [perfUserId]);
      await moviesPool.query('delete from users where id = $1', [perfUserId]);
    }
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

/** The balance of 'Account n' from the seed formula, computed here and not by SQL. */
function expectedBalance(n: number): bigint {
  let sum = BigInt(n) * 100n;
  for (let g = 1; g <= MOVEMENTS; g += 1) {
    if (g % ACCOUNTS === n - 1) sum += BigInt((g % 2001) - 1000) * 100n;
  }
  return sum;
}

interface ListedAccount {
  name: string;
  currency: 'ARS' | 'USD';
  balance: string;
}

describe('accounts list latency (NFR-02)', () => {
  it('keeps p95 of the list below 300 ms for 100 accounts and 100,000 movements', async () => {
    const movements = new SqlMovements(moviesPool);
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
    await moviesPool.query(
      `insert into accounts (owner_id, name, type, currency, opening_balance)
       select $1, 'Account ' || n, 'cash', case when n % 2 = 0 then 'ARS' else 'USD' end, n * 100
         from generate_series(1, $2::int) as n`,
      [userId, ACCOUNTS],
    );
    await moviesPool.query('drop table if exists perf_movements');
    await moviesPool.query(
      'create table perf_movements (account_id uuid not null, amount bigint not null)',
    );
    await moviesPool.query(
      `insert into perf_movements (account_id, amount)
       select a.id, ((g % 2001) - 1000)::bigint * 100
         from generate_series(1, $1::int) as g
         join (select id, substring(name from 9)::int as n from accounts) a
           on a.n = (g % $2::int) + 1`,
      [MOVEMENTS, ACCOUNTS],
    );
    await moviesPool.query(
      'create index perf_movements_account_idx on perf_movements (account_id)',
    );
    await moviesPool.query('analyze perf_movements');
    const seeded = await moviesPool.query<{ rows: string; accounts: string }>(
      `select (select count(*) from perf_movements) as rows,
              (select count(*) from accounts where owner_id = $1) as accounts`,
      [userId],
    );
    expect(seeded.rows[0]).toEqual({ rows: String(MOVEMENTS), accounts: String(ACCOUNTS) });

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
      totals: Record<string, string>;
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
    let ars = 0n;
    let usd = 0n;
    for (let n = 1; n <= ACCOUNTS; n += 1) {
      if (n % 2 === 0) ars += expectedBalance(n);
      else usd += expectedBalance(n);
    }
    expect(body.totals).toEqual({ ARS: ars.toString(), USD: usd.toString() });

    // The balances of the whole page come from one adapter call per list request.
    expect(movements.sumsCalls).toBe(WARM_UP_REQUESTS + REQUESTS + 1);

    const p95 = percentile(latencies, 95);
    console.log(
      `[NFR-02] accounts list: ${latencies.length} requests, p95 = ${p95.toFixed(1)} ms (limit ${MAX_P95_MS} ms)`,
    );
    expect(Object.fromEntries(statuses)).toEqual({ 200: REQUESTS });
    expect(p95).toBeLessThan(MAX_P95_MS);
  }, 180_000);
});
