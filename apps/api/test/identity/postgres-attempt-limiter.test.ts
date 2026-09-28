import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AttemptPolicy } from '../../src/identity/application/ports/attempt-limiter';
import type { Clock } from '../../src/identity/application/ports/clock';
import { PostgresAttemptLimiter } from '../../src/identity/infrastructure/db/postgres-attempt-limiter';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;

const clock = { current: new Date('2026-09-26T12:00:00.000Z') };
const fixedClock: Clock = { now: () => clock.current };

const SIGN_IN_ACCOUNT: AttemptPolicy = { kind: 'sign_in_account', limit: 5, windowSeconds: 900 };
const SIGN_IN_IP: AttemptPolicy = { kind: 'sign_in_ip', limit: 20, windowSeconds: 900 };

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

function limiter(): PostgresAttemptLimiter {
  return new PostgresAttemptLimiter(connection.db, fixedClock);
}

async function recordTimes(policy: AttemptPolicy, key: string, times: number) {
  const results = [];
  for (let i = 0; i < times; i += 1) results.push(await limiter().record(policy, key));
  return results;
}

describe('PostgresAttemptLimiter', () => {
  it('counts per key and window and resets on the next window (NFR-03)', async () => {
    clock.current = new Date('2026-09-26T12:00:00.000Z');

    const results = await recordTimes(SIGN_IN_ACCOUNT, 'ana@example.com', 6);
    expect(results.map((result) => result.count)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, true, true, false]);
    expect(await limiter().isLimitReached(SIGN_IN_ACCOUNT, 'ana@example.com')).toBe(true);

    // Another key and another kind with the same key have their own counters.
    expect(await limiter().isLimitReached(SIGN_IN_ACCOUNT, 'bob@example.com')).toBe(false);
    expect(await limiter().record(SIGN_IN_IP, 'ana@example.com')).toEqual({
      count: 1,
      allowed: true,
      windowStart: new Date('2026-09-26T12:00:00.000Z'),
    });

    // 12:14:59 is still inside the 12:00 window of 15 minutes.
    clock.current = new Date('2026-09-26T12:14:59.999Z');
    expect(await limiter().isLimitReached(SIGN_IN_ACCOUNT, 'ana@example.com')).toBe(true);

    // 12:15:00 starts a new fixed window.
    clock.current = new Date('2026-09-26T12:15:00.000Z');
    expect(await limiter().isLimitReached(SIGN_IN_ACCOUNT, 'ana@example.com')).toBe(false);
    expect(await limiter().record(SIGN_IN_ACCOUNT, 'ana@example.com')).toEqual({
      count: 1,
      allowed: true,
      windowStart: new Date('2026-09-26T12:15:00.000Z'),
    });
  });

  it('reports the limit as reached only once `limit` attempts exist', async () => {
    clock.current = new Date('2026-09-26T13:00:00.000Z');
    await recordTimes(SIGN_IN_ACCOUNT, 'carla@example.com', 4);
    expect(await limiter().isLimitReached(SIGN_IN_ACCOUNT, 'carla@example.com')).toBe(false);
    await recordTimes(SIGN_IN_ACCOUNT, 'carla@example.com', 1);
    expect(await limiter().isLimitReached(SIGN_IN_ACCOUNT, 'carla@example.com')).toBe(true);
  });

  it('does not lose increments under concurrency', async () => {
    clock.current = new Date('2026-09-26T14:00:00.000Z');
    await Promise.all(
      Array.from({ length: 10 }, () => limiter().record(SIGN_IN_IP, '203.0.113.7')),
    );
    const rows = await connection.pool.query<{ count: number }>(
      "select count from auth_attempts where kind = 'sign_in_ip' and key = '203.0.113.7'",
    );
    expect(rows.rows).toEqual([{ count: 10 }]);
  });

  it('aligns windows to the epoch so every instance computes the same window', async () => {
    clock.current = new Date('2026-09-26T12:07:31.000Z');
    await limiter().record({ kind: 'register_ip', limit: 5, windowSeconds: 3600 }, '198.51.100.1');

    const rows = await connection.pool.query<{ window_start: Date }>(
      'select window_start from auth_attempts',
    );
    expect(rows.rows).toEqual([{ window_start: new Date('2026-09-26T12:00:00.000Z') }]);
  });

  it('releases one unit of the window the reservation was recorded in, never below zero', async () => {
    clock.current = new Date('2026-09-26T15:00:00.000Z');
    const [first] = await recordTimes(SIGN_IN_ACCOUNT, 'dana@example.com', 3);
    const windowStart = first?.windowStart ?? new Date(0);
    expect(windowStart).toEqual(new Date('2026-09-26T15:00:00.000Z'));

    await limiter().release(SIGN_IN_ACCOUNT, 'dana@example.com', windowStart);
    const counts = async () =>
      (
        await connection.pool.query<{ count: number }>(
          "select count from auth_attempts where key = 'dana@example.com'",
        )
      ).rows;
    expect(await counts()).toEqual([{ count: 2 }]);

    for (let i = 0; i < 3; i += 1) {
      await limiter().release(SIGN_IN_ACCOUNT, 'dana@example.com', windowStart);
    }
    expect(await counts()).toEqual([{ count: 0 }]);

    // Other keys and a key without a window are untouched; nothing is created.
    await limiter().release(SIGN_IN_ACCOUNT, 'nobody@example.com', windowStart);
    const rows = await connection.pool.query('select key from auth_attempts');
    expect(rows.rows).toEqual([{ key: 'dana@example.com' }]);
  });

  it('a refund that runs after the window boundary decrements the old window, not the new one (B-2)', async () => {
    // Someone else's attempts already fill part of the 12:15 window.
    clock.current = new Date('2026-09-26T12:15:00.000Z');
    await recordTimes(SIGN_IN_ACCOUNT, 'erin@example.com', 3);

    clock.current = new Date('2026-09-26T12:14:59.999Z');
    const reservation = await limiter().record(SIGN_IN_ACCOUNT, 'erin@example.com');
    expect(reservation.windowStart).toEqual(new Date('2026-09-26T12:00:00.000Z'));

    clock.current = new Date('2026-09-26T12:15:00.001Z');
    await limiter().release(SIGN_IN_ACCOUNT, 'erin@example.com', reservation.windowStart);

    const rows = await connection.pool.query<{ window_start: Date; count: number }>(
      "select window_start, count from auth_attempts where key = 'erin@example.com' order by window_start",
    );
    expect(rows.rows).toEqual([
      { window_start: new Date('2026-09-26T12:00:00.000Z'), count: 0 },
      { window_start: new Date('2026-09-26T12:15:00.000Z'), count: 3 },
    ]);
  });

  it('purges windows older than a cutoff', async () => {
    clock.current = new Date('2026-09-25T10:00:00.000Z');
    await limiter().record(SIGN_IN_IP, 'old');
    clock.current = new Date('2026-09-26T10:00:00.000Z');
    await limiter().record(SIGN_IN_IP, 'recent');

    const purged = await limiter().purgeOlderThan(new Date('2026-09-25T12:00:00.000Z'));

    expect(purged).toBe(1);
    const rows = await connection.pool.query<{ key: string }>('select key from auth_attempts');
    expect(rows.rows).toEqual([{ key: 'recent' }]);
  });
});
