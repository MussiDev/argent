import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetryableError } from '@pesly/shared';
import {
  CreateMovement,
  type CreateMovementInput,
} from '../../src/movements/application/create-movement';
import { RecordManualMovement } from '../../src/movements/application/record-manual-movement';
import type { WritePolicy } from '../../src/movements/application/ports/movement-write-limiter';
import { MovementWriteRateLimited } from '../../src/movements/domain/errors';
import { DrizzleAccountLookup } from '../../src/movements/infrastructure/db/drizzle-account-lookup';
import { DrizzleCategoryLookup } from '../../src/movements/infrastructure/db/drizzle-category-lookup';
import { DrizzleMovementRepository } from '../../src/movements/infrastructure/db/drizzle-movement-repository';
import { DrizzleMovementWriteLimiter } from '../../src/movements/infrastructure/db/drizzle-movement-write-limiter';
import { DrizzleRateLookup } from '../../src/movements/infrastructure/db/drizzle-rate-lookup';
import { DrizzleUserPreferences } from '../../src/movements/infrastructure/db/drizzle-user-preferences';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newUserId, writeScope } from './db-fixtures';
import { MutableClock } from './fakes';

let connection: DatabaseConnection;

const POLICY: WritePolicy = { limit: 3, windowSeconds: 60 };
const T0 = new Date('2026-10-02T12:00:10.000Z');
const WINDOW_0 = new Date('2026-10-02T12:00:00.000Z');
const WINDOW_1 = new Date('2026-10-02T12:01:00.000Z');

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

function limiterAt(clock: MutableClock): DrizzleMovementWriteLimiter {
  return new DrizzleMovementWriteLimiter(connection.db, clock);
}

async function rowsOf(ownerId: string): Promise<Map<number, number>> {
  const result = await connection.pool.query<{ window_start: Date; count: number }>(
    'select window_start, count from movement_rate_limits where owner_id = $1',
    [ownerId],
  );
  return new Map(result.rows.map((row) => [row.window_start.getTime(), row.count]));
}

describe('DrizzleMovementWriteLimiter', () => {
  it('counts per owner and window and flags the unit that exceeds the limit', async () => {
    const clock = new MutableClock(T0);
    const limiter = limiterAt(clock);
    const alice = await newUserId(connection.db);
    const bob = await newUserId(connection.db);
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await limiter.record(alice, POLICY));
    expect(results.map((r) => [r.count, r.allowed])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, false],
    ]);
    expect(results[0]?.windowStart).toEqual(WINDOW_0);
    expect(await limiter.record(bob, POLICY)).toMatchObject({ count: 1, allowed: true });
  });

  it('two instances on the same database never lose an increment', async () => {
    const clock = new MutableClock(T0);
    const one = limiterAt(clock);
    const two = limiterAt(clock);
    const owner = await newUserId(connection.db);
    const policy = { limit: 1000, windowSeconds: 60 };
    const reservations = await Promise.all(
      Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? one : two).record(owner, policy)),
    );
    expect(new Set(reservations.map((r) => r.count)).size).toBe(50);
    expect((await rowsOf(owner)).get(WINDOW_0.getTime())).toBe(50);
  });

  it('a second instance sees the count of the first one (no state in memory)', async () => {
    const clock = new MutableClock(T0);
    const owner = await newUserId(connection.db);
    await limiterAt(clock).record(owner, POLICY);
    await limiterAt(clock).record(owner, POLICY);
    expect(await limiterAt(clock).record(owner, POLICY)).toMatchObject({ count: 3 });
  });

  it('a new minute starts at one and removes the older windows of the owner', async () => {
    const clock = new MutableClock(T0);
    const limiter = limiterAt(clock);
    const owner = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    await limiter.record(owner, POLICY);
    await limiter.record(other, POLICY);
    clock.current = new Date('2026-10-02T12:01:05.000Z');
    const next = await limiter.record(owner, POLICY);
    expect(next).toMatchObject({ count: 1, windowStart: WINDOW_1 });
    expect([...(await rowsOf(owner)).keys()]).toEqual([WINDOW_1.getTime()]);
    expect((await rowsOf(other)).get(WINDOW_0.getTime())).toBe(1);
  });

  it('release refunds exactly the given window and never goes below zero', async () => {
    const clock = new MutableClock(T0);
    const limiter = limiterAt(clock);
    const owner = await newUserId(connection.db);
    const first = await limiter.record(owner, POLICY);
    await limiter.record(owner, POLICY);
    clock.current = new Date('2026-10-02T12:01:05.000Z');
    await limiter.record(owner, POLICY);
    // The late refund of the old window leaves the new one untouched (the old row is gone).
    await limiter.release(owner, POLICY, first.windowStart);
    expect((await rowsOf(owner)).get(WINDOW_1.getTime())).toBe(1);
    await limiter.release(owner, POLICY, WINDOW_1);
    await limiter.release(owner, POLICY, WINDOW_1);
    await limiter.release(owner, POLICY, WINDOW_1);
    expect((await rowsOf(owner)).get(WINDOW_1.getTime())).toBe(0);
  });

  it('release decrements only the window it is given when two exist', async () => {
    const clock = new MutableClock(T0);
    const limiter = limiterAt(clock);
    const owner = await newUserId(connection.db);
    await limiter.record(owner, POLICY);
    await connection.pool.query(
      'insert into movement_rate_limits (owner_id, window_start, count) values ($1, $2, 5)',
      [owner, WINDOW_1],
    );
    await limiter.release(owner, POLICY, WINDOW_0);
    const rows = await rowsOf(owner);
    expect(rows.get(WINDOW_0.getTime())).toBe(0);
    expect(rows.get(WINDOW_1.getTime())).toBe(5);
  });
});

describe('RecordManualMovement with the real limiter and repository', () => {
  it('100 parallel calls store exactly 60 movements and rate-limit the rest', async () => {
    const clock = new MutableClock(new Date());
    const owner = await newUserId(connection.db);
    const accountId = await newAccount(connection.pool, owner);
    const categoryId = await newCategory(connection.pool, owner, 'expense');
    const createMovement = new CreateMovement({
      movements: new DrizzleMovementRepository(connection.db),
      accounts: new DrizzleAccountLookup(connection.db),
      categories: new DrizzleCategoryLookup(connection.db),
      rates: new DrizzleRateLookup(connection.db),
      preferences: new DrizzleUserPreferences(connection.db),
      clock,
    });
    const releaseFailures: unknown[] = [];
    const record = new RecordManualMovement({
      createMovement,
      limiter: limiterAt(clock),
      clock,
      reportReleaseFailure: (error) => releaseFailures.push(error),
    });
    const scope = await writeScope(owner);
    const input: CreateMovementInput = {
      type: 'expense',
      accountId,
      categoryId,
      amount: 100n,
      occurredAt: new Date(clock.now().getTime() - 3_600_000),
      rate: { source: 'manual', value: 14_000_000n },
    };
    const outcomes = await Promise.allSettled(
      Array.from({ length: 100 }, () => record.execute(scope, input)),
    );
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(60);
    expect(rejected).toHaveLength(40);
    for (const { reason } of rejected) {
      expect(reason).toBeInstanceOf(MovementWriteRateLimited);
      expect(reason).toBeInstanceOf(RetryableError);
    }
    const stored = await connection.pool.query<{ total: string }>(
      'select count(*) as total from movements where owner_id = $1',
      [owner],
    );
    expect(stored.rows[0]?.total).toBe('60');
    expect(releaseFailures).toEqual([]);
  });
});
