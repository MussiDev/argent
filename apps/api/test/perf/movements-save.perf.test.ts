import { createServer, type Server } from 'node:http';
import autocannon from 'autocannon';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMovementRoutes } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { assertIsTestDatabase, testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { MOVEMENTS, removeDataset, seedDataset } from './movements-seed';

/**
 * NFR-03 benchmark: p95 of `POST /movements` (one insert, one limiter upsert and four indexed point
 * reads, no external call) for a user who already has 100 accounts and 100,000 movements. The
 * write limit is raised so the limiter never answers 429 during the run. Timing-dependent: run it
 * with `pnpm test:perf`.
 */

const REQUESTS = 500;
const WARM_UP_REQUESTS = 20;
const CONNECTIONS = 8;
const MAX_P95_MS = 300;
const PASSWORD = 'a long enough passphrase';
const EMAIL = 'perf-movements-save@example.com';
const RAISED_WRITE_LIMIT = 100_000;

let connection: DatabaseConnection;
let pool: pg.Pool;
let server: Server | undefined;
let perfUserId: string | undefined;

beforeAll(() => {
  assertIsTestDatabase(testDatabaseUrl);
  connection = createDatabase(testDatabaseUrl);
  pool = new pg.Pool({ connectionString: testDatabaseUrl, max: CONNECTIONS });
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
    if (perfUserId) await removeDataset(pool, perfUserId);
  } finally {
    await pool.end();
    await connection.pool.end();
  }
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

describe('movement save latency (NFR-03)', () => {
  it('keeps p95 of saving a movement below 300 ms', async () => {
    const routes = createMovementRoutes({
      db: connection.db,
      logger: createLogger({ level: 'error', destination: { write: () => undefined } }),
      writeLimit: RAISED_WRITE_LIMIT,
    });
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [routes],
    });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    perfUserId = userId;
    const cookies = sessionFrom(await signIn(harness.app, EMAIL, PASSWORD));

    // Seeding failures (including an unreachable database) fail the run: nothing here is caught.
    const { expenseCategoryId } = await seedDataset(pool, userId);
    const target = await pool.query<{ id: string }>(
      `select id from accounts where owner_id = $1 and name = 'Account 1'`,
      [userId],
    );
    const accountId = target.rows[0]?.id;
    if (!accountId) throw new Error('The seeded account was not found');

    server = createServer(harness.app);
    const listening = server;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    const address = listening.address();
    if (!address || typeof address !== 'object') throw new Error('server not listening');
    const url = `http://127.0.0.1:${address.port}`;

    const body = JSON.stringify({
      type: 'expense',
      accountId,
      categoryId: expenseCategoryId,
      amount: '1500',
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
      rate: { source: 'manual', value: '14000000' },
    });

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
                method: 'POST',
                path: '/movements',
                headers: {
                  ...trustedHeaders,
                  'content-type': 'application/json',
                  cookie: cookieHeader(cookies),
                },
                body,
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
    const warmUp = await load(WARM_UP_REQUESTS);
    expect(Object.fromEntries(warmUp.statuses)).toEqual({ 201: WARM_UP_REQUESTS });
    const { statuses, latencies } = await load(REQUESTS);

    // Every request really inserted a row, so a route answering 201 without saving cannot pass.
    const stored = await pool.query<{ n: string }>(
      'select count(*) as n from movements where owner_id = $1',
      [userId],
    );
    expect(stored.rows[0]?.n).toBe(String(MOVEMENTS + WARM_UP_REQUESTS + REQUESTS));

    const p95 = percentile(latencies, 95);
    console.log(
      `[NFR-03] movement save: ${latencies.length} requests, p95 = ${p95.toFixed(1)} ms (limit ${MAX_P95_MS} ms)`,
    );
    expect(Object.fromEntries(statuses)).toEqual({ 201: REQUESTS });
    expect(p95).toBeLessThan(MAX_P95_MS);
  }, 180_000);
});
