import { createServer, type Server } from 'node:http';
import autocannon from 'autocannon';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createInvestmentsRoutes } from '../../src/investments';
import { holdings, portfolios } from '../../src/investments/infrastructure/db/schema';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';

/**
 * NFR-03 benchmark: p95 of the portfolio list for one user with 10 portfolios and 500 holdings,
 * through the real app and the test database. Timing-dependent, so it runs with `pnpm test:perf`,
 * not `pnpm test`.
 *
 * The measurement is cold: no warmup, and closed-loop with 8 connections, so it is stricter than
 * the NFR.
 */

const REQUESTS = 500;
const CONNECTIONS = 8;
const MAX_P95_MS = 500;
const PORTFOLIOS = 10;
const HOLDINGS_PER_PORTFOLIO = 50;
const PASSWORD = 'a long enough passphrase';
const EMAIL = 'investor@perf.test';

let connection: DatabaseConnection;
let server: Server | undefined;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server) {
      server.close(() => {
        resolve();
      });
    } else {
      resolve();
    }
  });
  server = undefined;
});

afterAll(async () => {
  await connection.pool.end();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

/** Half of the holdings carry a price, so the list exercises both valuation paths. */
async function seedHoldings(ownerId: string): Promise<void> {
  const pricedAt = new Date();
  for (let p = 0; p < PORTFOLIOS; p += 1) {
    const [portfolio] = await connection.db
      .insert(portfolios)
      .values({ ownerId, name: `Portfolio ${p}` })
      .returning({ id: portfolios.id });
    if (!portfolio) throw new Error('portfolio not inserted');
    await connection.db.insert(holdings).values(
      Array.from({ length: HOLDINGS_PER_PORTFOLIO }, (_, h) => {
        const priced = h % 2 === 0;
        return {
          portfolioId: portfolio.id,
          ownerId,
          ticker: `T${h}`,
          instrumentName: `Instrument ${p}-${h}`,
          instrumentType: 'stock' as const,
          quantity: BigInt(h + 1) * 100_000_000n,
          valuationCurrency: h % 4 === 0 ? ('USD' as const) : ('ARS' as const),
          totalCost: 1_000_000n,
          ...(priced ? { unitPrice: 150_000n, priceSource: 'manual' as const, pricedAt } : {}),
        };
      }),
    );
  }
}

describe('portfolio list latency (NFR-03)', () => {
  it('keeps p95 of the list below 500 ms with 10 portfolios and 500 holdings', async () => {
    const logger = createLogger({ level: 'silent', destination: { write: () => undefined } });
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [createInvestmentsRoutes({ db: connection.db, logger })],
    });
    const ownerId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    await seedHoldings(ownerId);
    const cookie = cookieHeader(sessionFrom(await signIn(harness.app, EMAIL, PASSWORD)));

    server = createServer(harness.app);
    const target = server;
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const address = target.address();
    if (!address || typeof address !== 'object') throw new Error('server not listening');

    const statuses = new Map<number, number>();
    const latencies: number[] = [];
    await new Promise<void>((resolve, reject) => {
      const instance = autocannon(
        {
          url: `http://127.0.0.1:${address.port}`,
          connections: CONNECTIONS,
          amount: REQUESTS,
          timeout: 30,
          requests: [
            {
              method: 'GET',
              path: '/investments/portfolios',
              headers: { ...trustedHeaders, cookie },
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

    expect(Object.fromEntries(statuses)).toEqual({ 200: REQUESTS });
    const p95 = percentile(latencies, 95);
    console.info(`portfolio list p95: ${p95} ms`);
    expect(p95, `p95 was ${p95} ms, limit ${MAX_P95_MS} ms`).toBeLessThan(MAX_P95_MS);
  }, 120_000);
});
