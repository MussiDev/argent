import { createServer, type Server } from 'node:http';
import autocannon from 'autocannon';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';

/**
 * NFR-01 benchmark: p95 of `PATCH /profile` under concurrent load, against the test database with
 * the real session middleware. Timing-dependent, so it is not part of `pnpm test`: run it with
 * `pnpm test:perf`.
 */

const REQUESTS = 500;
const CONNECTIONS = 8;
const MAX_P95_MS = 300;
const PASSWORD = 'a long enough passphrase';
const LANGUAGES = ['es', 'en'] as const;

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

describe('profile latency (NFR-01)', () => {
  it('keeps p95 of PATCH /profile below 300 ms over 500 requests on 8 connections', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    server = createServer(harness.app);
    const target = server;
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const address = target.address();
    if (!address || typeof address !== 'object') throw new Error('server not listening');
    const url = `http://127.0.0.1:${address.port}`;

    await seedUser(connection, { email: 'bench@example.com', password: PASSWORD });
    const signedIn = await signIn(harness.app, 'bench@example.com', PASSWORD);
    expect(signedIn.status).toBe(200);
    const cookie = cookieHeader(sessionFrom(signedIn));

    let sent = 0;
    const statuses = new Map<number, number>();
    const latencies: number[] = [];
    await new Promise<void>((resolve, reject) => {
      const instance = autocannon(
        {
          url,
          connections: CONNECTIONS,
          amount: REQUESTS,
          timeout: 30,
          requests: [
            {
              method: 'PATCH',
              path: '/profile',
              setupRequest: (request) => {
                sent += 1;
                return {
                  ...request,
                  headers: {
                    ...trustedHeaders,
                    'content-type': 'application/json',
                    cookie,
                  },
                  body: JSON.stringify({
                    displayName: `Bench ${sent}`,
                    language: LANGUAGES[sent % 2],
                  }),
                };
              },
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
    expect(percentile(latencies, 95)).toBeLessThan(MAX_P95_MS);
  }, 120_000);
});
