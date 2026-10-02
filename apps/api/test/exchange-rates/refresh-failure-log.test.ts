import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RateProviderFailureCode } from '../../src/exchange-rates/domain/errors';
import { DrizzleRefreshFailureLog } from '../../src/exchange-rates/infrastructure/db/drizzle-refresh-failure-log';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
let log: DrizzleRefreshFailureLog;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  log = new DrizzleRefreshFailureLog(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

interface FailureRow {
  failed_at: Date;
  code: string;
  status_code: number | null;
  detail: string | null;
}

async function rows(): Promise<FailureRow[]> {
  const result = await connection.pool.query<FailureRow>(
    'select failed_at, code, status_code, detail from exchange_rate_refresh_failures order by failed_at',
  );
  return result.rows;
}

const AT = new Date('2026-10-02T12:00:00.000Z');

describe('DrizzleRefreshFailureLog', () => {
  it('round-trips a record with code, status code and detail', async () => {
    await log.record({ at: AT, code: 'provider_bad_status', statusCode: 503, detail: 'blue' });

    expect(await rows()).toEqual([
      { failed_at: AT, code: 'provider_bad_status', status_code: 503, detail: 'blue' },
    ]);
  });

  it('stores nulls when the status code and detail are absent', async () => {
    await log.record({ at: AT, code: 'provider_timeout' });

    expect(await rows()).toEqual([
      { failed_at: AT, code: 'provider_timeout', status_code: null, detail: null },
    ]);
  });

  it('truncates a 300-character detail to 200 characters', async () => {
    await log.record({ at: AT, code: 'provider_invalid_payload', detail: 'y'.repeat(300) });

    const [row] = await rows();
    expect(row?.detail).toBe('y'.repeat(200));
  });

  it('keeps a detail of exactly 200 characters and a null detail', async () => {
    await log.record({ at: AT, code: 'provider_invalid_payload', detail: 'z'.repeat(200) });
    await log.record({ at: AT, code: 'provider_timeout', detail: undefined });

    expect((await rows()).map((row) => row.detail)).toEqual(['z'.repeat(200), null]);
  });

  it('purgeOlderThan deletes only older rows and returns the count', async () => {
    const at = (offsetMs: number) => new Date(AT.getTime() + offsetMs);
    for (const offset of [-2000, -1, 0, 1000]) {
      await log.record({ at: at(offset), code: 'provider_unreachable' });
    }

    expect(await log.purgeOlderThan(AT)).toBe(2);
    expect((await rows()).map((row) => row.failed_at)).toEqual([AT, at(1000)]);
    expect(await log.purgeOlderThan(AT)).toBe(0);
  });

  it('rejects an unknown code and an out-of-range status code', async () => {
    const unknownCode = 'nope' as RateProviderFailureCode;
    await expect(log.record({ at: AT, code: unknownCode })).rejects.toThrow();
    await expect(
      log.record({ at: AT, code: 'provider_bad_status', statusCode: 99 }),
    ).rejects.toThrow();
    expect(await rows()).toEqual([]);
  });
});
