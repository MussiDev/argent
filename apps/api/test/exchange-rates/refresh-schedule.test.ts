import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleRefreshSchedule } from '../../src/exchange-rates/infrastructure/db/drizzle-refresh-schedule';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
let schedule: DrizzleRefreshSchedule;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  schedule = new DrizzleRefreshSchedule(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const LEASE_MS = 120_000;
const INTERVAL_MS = 60 * 60_000;
const RETRY_MS = 5 * 60_000;
const T0 = new Date('2026-10-02T12:00:00.000Z');
const after = (from: Date, ms: number) => new Date(from.getTime() + ms);

interface SyncRow {
  next_attempt_at: Date;
  last_success_at: Date | null;
  consecutive_failures: number;
}

async function syncRows(): Promise<SyncRow[]> {
  const result = await connection.pool.query<SyncRow>(
    'select next_attempt_at, last_success_at, consecutive_failures from exchange_rate_sync',
  );
  return result.rows;
}

async function claimed(now: Date): Promise<Date> {
  const lease = await schedule.claim(now, LEASE_MS);
  if (!lease) throw new Error('the claim was expected to succeed');
  return lease;
}

describe('DrizzleRefreshSchedule', () => {
  it('claims the first time, fails while the lease is open and succeeds once it has passed', async () => {
    expect(await schedule.claim(T0, LEASE_MS)).toEqual(after(T0, LEASE_MS));

    expect(await schedule.claim(after(T0, LEASE_MS - 1), LEASE_MS)).toBeNull();

    const reclaimAt = after(T0, LEASE_MS);
    expect(await schedule.claim(reclaimAt, LEASE_MS)).toEqual(after(reclaimAt, LEASE_MS));
    expect(await syncRows()).toHaveLength(1);
  });

  it('lets exactly one of two simultaneous claims win', async () => {
    const other = new DrizzleRefreshSchedule(connection.db);
    const results = await Promise.all([schedule.claim(T0, LEASE_MS), other.claim(T0, LEASE_MS)]);

    expect(results.filter((lease) => lease !== null)).toEqual([after(T0, LEASE_MS)]);
    expect(await syncRows()).toHaveLength(1);
  });

  it('succeeded schedules the next attempt 60 minutes ahead and resets the failures', async () => {
    await schedule.failed(await claimed(T0), T0, RETRY_MS);
    const second = await claimed(after(T0, RETRY_MS));

    const doneAt = after(T0, RETRY_MS + 1000);
    await schedule.succeeded(second, doneAt, INTERVAL_MS);

    expect(await syncRows()).toEqual([
      {
        next_attempt_at: after(doneAt, INTERVAL_MS),
        last_success_at: doneAt,
        consecutive_failures: 0,
      },
    ]);
  });

  it('failed schedules the retry 5 minutes ahead and counts the failures', async () => {
    await schedule.failed(await claimed(T0), T0, RETRY_MS);
    expect(await syncRows()).toEqual([
      { next_attempt_at: after(T0, RETRY_MS), last_success_at: null, consecutive_failures: 1 },
    ]);

    const retryAt = after(T0, RETRY_MS);
    await schedule.failed(await claimed(retryAt), retryAt, RETRY_MS);
    expect(await syncRows()).toEqual([
      {
        next_attempt_at: after(retryAt, RETRY_MS),
        last_success_at: null,
        consecutive_failures: 2,
      },
    ]);
  });

  it('a stale owner calling succeeded or failed changes nothing', async () => {
    const stale = await claimed(T0);
    const takeoverAt = after(T0, LEASE_MS + 1);
    expect(await claimed(takeoverAt)).toEqual(after(takeoverAt, LEASE_MS));
    const before = await syncRows();

    await schedule.succeeded(stale, after(takeoverAt, 10), INTERVAL_MS);
    await schedule.failed(stale, after(takeoverAt, 10), RETRY_MS);

    expect(await syncRows()).toEqual(before);
  });
});
