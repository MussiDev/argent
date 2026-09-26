import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../src/shared/db/client';
import { createIdentityHarness } from './helpers/identity-harness';
import { seedUser } from './helpers/session-client';
import { testDatabaseUrl } from './helpers/test-database';
import { trustedHeaders } from './helpers/test-env';

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

const PASSWORD = 'a long enough passphrase';
const PAIRS = 100;
const WARM_UP = 10;
/** Below the per-account limit (5), so no account ever answers 429 instead of 401. */
const FAILURES_PER_ACCOUNT = 4;
const MAX_MEDIAN_DIFFERENCE_MS = 50;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + upper) / 2 : upper;
}

describe('sign-in timing (NFR-08, R-02)', () => {
  it('has a median response-time difference below 50 ms between unknown email and wrong password over 200 requests', async () => {
    // Every request comes from its own address, so the per-IP limit (20) never answers instead.
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      env: { TRUST_PROXY: '1' },
    });
    const accounts = Math.ceil((PAIRS + WARM_UP) / FAILURES_PER_ACCOUNT);
    const emails: string[] = [];
    for (let index = 0; index < accounts; index += 1) {
      const email = `member${index}@example.com`;
      await seedUser(connection, { email, password: PASSWORD });
      emails.push(email);
    }
    server = createServer(harness.app);
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const target = server;

    let requestNumber = 0;
    async function timedSignIn(
      email: string,
    ): Promise<{ ms: number; status: number; body: string }> {
      requestNumber += 1;
      const ip = `10.${Math.floor(requestNumber / 250)}.${requestNumber % 250}.1`;
      const started = performance.now();
      const response = await request(target)
        .post('/auth/sign-in')
        .set(trustedHeaders)
        .set('X-Forwarded-For', ip)
        .send({ email, password: 'not the right passphrase' });
      return { ms: performance.now() - started, status: response.status, body: response.text };
    }

    const wrongPassword = (index: number) =>
      timedSignIn(emails[Math.floor(index / FAILURES_PER_ACCOUNT)] ?? '');
    const unknownEmail = (index: number) => timedSignIn(`nobody${index}@example.com`);

    // Warm-up: JIT, connection pool and Argon2id thread pool, not measured.
    for (let index = 0; index < WARM_UP; index += 1) {
      await wrongPassword(PAIRS + index);
      await unknownEmail(PAIRS + index);
    }

    const known: number[] = [];
    const unknown: number[] = [];
    const bodies = new Set<string>();
    const statuses = new Set<number>();
    for (let index = 0; index < PAIRS; index += 1) {
      // Alternating the order cancels any bias from which request of a pair runs first.
      const pair =
        index % 2 === 0
          ? [await wrongPassword(index), await unknownEmail(index)]
          : [await unknownEmail(index), await wrongPassword(index)].reverse();
      const [wrong, missing] = pair;
      if (!wrong || !missing) throw new Error('missing measurement');
      known.push(wrong.ms);
      unknown.push(missing.ms);
      for (const result of pair) {
        bodies.add(result.body);
        statuses.add(result.status);
      }
    }

    expect([...statuses]).toEqual([401]);
    expect([...bodies]).toEqual([JSON.stringify({ code: 'INVALID_CREDENTIALS' })]);
    expect(known.length + unknown.length).toBe(2 * PAIRS);
    const difference = Math.abs(median(known) - median(unknown));
    expect(difference).toBeLessThan(MAX_MEDIAN_DIFFERENCE_MS);
  }, 120_000);
});
