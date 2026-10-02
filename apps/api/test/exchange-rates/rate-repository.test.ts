import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RATE_MAX_SCALED, RATE_TYPES, type RateType } from '@pesly/shared';
import { DrizzleRateRepository } from '../../src/exchange-rates/infrastructure/db/drizzle-rate-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { sampleQuotes } from './fakes';

let connection: DatabaseConnection;
let repository: DrizzleRateRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleRateRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const FETCHED_AT = new Date('2026-10-02T12:00:00.000Z');

function sqlStateOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code: unknown = Reflect.get(current, 'code');
    if (typeof code === 'string') return code;
    current = current.cause;
  }
  return undefined;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('DrizzleRateRepository', () => {
  it('findAll on an empty table returns an empty list', async () => {
    expect(await repository.findAll()).toEqual([]);
  });

  it('replaceAll stores 7 rows and a second call replaces them all in place', async () => {
    await repository.replaceAll(sampleQuotes(), FETCHED_AT);
    const first = await repository.findAll();
    expect(first).toHaveLength(7);
    expect(first.map((rate) => rate.rateType).sort()).toEqual([...RATE_TYPES].sort());
    expect(first.every((rate) => rate.fetchedAt.getTime() === FETCHED_AT.getTime())).toBe(true);

    const later = new Date('2026-10-02T13:00:00.000Z');
    const updated = sampleQuotes(new Date('2026-10-02T12:55:00.000Z')).map((quote) => ({
      ...quote,
      buy: quote.buy + 1n,
      sell: quote.sell + 1n,
    }));
    await repository.replaceAll(updated, later);

    const second = await repository.findAll();
    expect(second).toHaveLength(7);
    for (const quote of updated) {
      expect(second.find((rate) => rate.rateType === quote.rateType)).toEqual({
        ...quote,
        fetchedAt: later,
      });
    }
  });

  it('round-trips the maximum value exactly as bigint', async () => {
    const nearMax = RATE_MAX_SCALED - 1n;
    const quotes = sampleQuotes().map((quote) => ({
      ...quote,
      buy: RATE_MAX_SCALED,
      sell: nearMax,
    }));
    await repository.replaceAll(quotes, FETCHED_AT);

    const stored = await repository.findAll();
    expect(stored.every((rate) => rate.buy === RATE_MAX_SCALED && rate.sell === nearMax)).toBe(
      true,
    );
    expect(stored.every((rate) => typeof rate.buy === 'bigint')).toBe(true);
  });

  it.each([0n, -1n, RATE_MAX_SCALED + 1n])(
    'rejects a rate of %s with a check violation',
    async (bad) => {
      const quotes = sampleQuotes().map((quote, index) =>
        index === 0 ? { ...quote, buy: bad } : quote,
      );
      const error = await rejection(repository.replaceAll(quotes, FETCHED_AT));
      expect(sqlStateOf(error)).toBe('23514');
    },
  );

  it('rejects an unknown rate_type with a check violation', async () => {
    const quotes = sampleQuotes().map((quote, index) =>
      index === 0 ? { ...quote, rateType: 'euro' as RateType } : quote,
    );
    const error = await rejection(repository.replaceAll(quotes, FETCHED_AT));
    expect(sqlStateOf(error)).toBe('23514');
  });

  it('keeps the previous 7 rows when a replace fails', async () => {
    await repository.replaceAll(sampleQuotes(), FETCHED_AT);
    const before = await repository.findAll();

    const broken = sampleQuotes().map((quote, index) =>
      index === 6 ? { ...quote, sell: 0n } : quote,
    );
    await expect(
      repository.replaceAll(broken, new Date('2026-10-02T14:00:00.000Z')),
    ).rejects.toThrow();

    expect(await repository.findAll()).toEqual(before);
  });
});
