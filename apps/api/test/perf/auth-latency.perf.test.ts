import { createServer, type Server } from 'node:http';
import autocannon from 'autocannon';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createIdentityHarness } from '../helpers/identity-harness';
import { seedUser } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';

/**
 * NFR-06 benchmark: p95 of sign-in and registration under concurrent load, against the test
 * database with every real adapter except the breach checker (fake, no network in tests).
 * Timing-dependent, so it is not part of `pnpm test`: run it with `pnpm test:perf`
 * (vitest.perf.config.ts pins UV_THREADPOOL_SIZE, which bounds parallel Argon2id work).
 */

const REQUESTS = 500;
const CONNECTIONS = 8;
const MAX_P95_MS = 500;
const PASSWORD = 'a long enough passphrase';

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

async function listen(): Promise<string> {
  // Varying X-Forwarded-For per request needs one trusted proxy hop.
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    env: { TRUST_PROXY: '1' },
  });
  server = createServer(harness.app);
  const target = server;
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  const address = target.address();
  if (!address || typeof address !== 'object') throw new Error('server not listening');
  return `http://127.0.0.1:${address.port}`;
}

interface LoadResult {
  statuses: Map<number, number>;
  latencies: number[];
}

/** Sends `REQUESTS` requests; `body(n)` builds the n-th body; each request has its own client IP. */
function load(url: string, path: string, body: (n: number) => unknown): Promise<LoadResult> {
  let sent = 0;
  const statuses = new Map<number, number>();
  const latencies: number[] = [];
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url,
        connections: CONNECTIONS,
        amount: REQUESTS,
        timeout: 30,
        requests: [
          {
            method: 'POST',
            path,
            setupRequest: (request) => {
              sent += 1;
              return {
                ...request,
                headers: {
                  ...trustedHeaders,
                  'content-type': 'application/json',
                  'x-forwarded-for': `10.${Math.floor(sent / 250)}.${sent % 250}.7`,
                },
                body: JSON.stringify(body(sent)),
              };
            },
          },
        ],
      },
      (error) => {
        if (error) reject(error instanceof Error ? error : new Error(String(error)));
        else resolve({ statuses, latencies });
      },
    );
    instance.on('response', (_client, statusCode, _bytes, responseTime) => {
      statuses.set(statusCode, (statuses.get(statusCode) ?? 0) + 1);
      latencies.push(responseTime);
    });
  });
}

describe('auth latency (NFR-06)', () => {
  it('keeps p95 of sign-in below 500 ms over 500 requests', async () => {
    const url = await listen();
    // One account per request, like real traffic: parallel sign-ins to a single account beyond
    // its failure limit are refused by the reserve-then-refund limiter (R-01), by design.
    for (let n = 0; n < REQUESTS; n += 1) {
      await seedUser(connection, { email: `member${n}@example.com`, password: PASSWORD });
    }

    const result = await load(url, '/auth/sign-in', (n) => ({
      email: `member${n % REQUESTS}@example.com`,
      password: PASSWORD,
    }));

    expect(Object.fromEntries(result.statuses)).toEqual({ 200: REQUESTS });
    expect(percentile(result.latencies, 95)).toBeLessThan(MAX_P95_MS);
  }, 180_000);

  it('keeps p95 of registration below 500 ms over 500 requests', async () => {
    const url = await listen();

    const result = await load(url, '/auth/register', (n) => ({
      email: `bench${n}@example.com`,
      password: PASSWORD,
      displayName: `Bench ${n}`,
    }));

    expect(Object.fromEntries(result.statuses)).toEqual({ 202: REQUESTS });
    expect(percentile(result.latencies, 95)).toBeLessThan(MAX_P95_MS);
  }, 180_000);
});
