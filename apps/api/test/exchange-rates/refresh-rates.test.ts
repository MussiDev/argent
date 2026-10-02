import { beforeEach, describe, expect, it } from 'vitest';
import { RATE_TYPES } from '@pesly/shared';
import { GetLatestRates } from '../../src/exchange-rates/application/get-latest-rates';
import {
  LEASE_MS,
  REFRESH_INTERVAL_MS,
  RETRY_DELAY_MS,
  RefreshRates,
} from '../../src/exchange-rates/application/refresh-rates';
import { RateProviderFailure } from '../../src/exchange-rates/domain/errors';
import {
  InMemoryRateRepository,
  InMemoryRefreshFailureLog,
  InMemoryRefreshSchedule,
  MutableClock,
  ScriptedRateProvider,
  sampleQuotes,
} from './fakes';

const MINUTE = 60_000;

describe('RefreshRates', () => {
  let provider: ScriptedRateProvider;
  let rates: InMemoryRateRepository;
  let schedule: InMemoryRefreshSchedule;
  let failures: InMemoryRefreshFailureLog;
  let clock: MutableClock;
  let refresh: RefreshRates;

  beforeEach(() => {
    provider = new ScriptedRateProvider();
    rates = new InMemoryRateRepository();
    schedule = new InMemoryRefreshSchedule();
    failures = new InMemoryRefreshFailureLog();
    clock = new MutableClock();
    refresh = new RefreshRates({ provider, rates, schedule, failures, clock });
  });

  async function seedOldRates(): Promise<void> {
    await rates.replaceAll(
      sampleQuotes(new Date('2026-10-01T00:00:00.000Z')),
      new Date('2026-10-01T00:01:00.000Z'),
    );
    schedule.nextAttemptAt = new Date(clock.now().getTime() - 1);
    rates.replaceCalls = 0;
  }

  it('exposes the documented timings', () => {
    expect(REFRESH_INTERVAL_MS).toBe(3_600_000);
    expect(RETRY_DELAY_MS).toBe(300_000);
    expect(LEASE_MS).toBe(300_000);
  });

  it('a successful refresh stores the 7 quotes with fetchedAt and moves the schedule 60 minutes ahead', async () => {
    const result = await refresh.execute();

    expect(result).toEqual({ outcome: 'refreshed' });
    expect(schedule.claims).toEqual([{ now: clock.now(), leaseMs: 5 * MINUTE }]);
    expect(rates.rows).toHaveLength(7);
    expect(rates.rows.every((r) => r.fetchedAt.getTime() === clock.now().getTime())).toBe(true);
    expect(schedule.nextAttemptAt).toEqual(new Date(clock.now().getTime() + 60 * MINUTE));
    expect(schedule.lastSuccessAt).toEqual(clock.now());
    expect(failures.records).toEqual([]);
  });

  it('a refresh that is not due calls no provider and stores nothing', async () => {
    await refresh.execute();
    provider.calls = 0;
    rates.replaceCalls = 0;
    clock.advance(30 * MINUTE);

    const result = await refresh.execute();

    expect(result).toEqual({ outcome: 'not_due' });
    expect(provider.calls).toBe(0);
    expect(rates.replaceCalls).toBe(0);
    expect(failures.records).toEqual([]);
  });

  it('an unreachable provider is a failed outcome: rates stay, one failure recorded, retry in 5 minutes', async () => {
    await seedOldRates();
    const before = [...rates.rows];
    provider.error = new RateProviderFailure('provider_unreachable');

    const result = await refresh.execute();

    expect(result).toEqual({ outcome: 'failed', code: 'provider_unreachable' });
    expect(rates.rows).toEqual(before);
    expect(rates.replaceCalls).toBe(0);
    expect(failures.records).toEqual([{ at: clock.now(), code: 'provider_unreachable' }]);
    expect(schedule.nextAttemptAt).toEqual(new Date(clock.now().getTime() + 5 * MINUTE));
    expect(schedule.consecutiveFailures).toBe(1);
  });

  it('a provider timeout records provider_timeout; a 500 status records provider_bad_status with the status code', async () => {
    provider.error = new RateProviderFailure('provider_timeout');
    expect(await refresh.execute()).toEqual({ outcome: 'failed', code: 'provider_timeout' });
    expect(failures.records[0]?.code).toBe('provider_timeout');

    clock.advance(6 * MINUTE);
    provider.error = new RateProviderFailure('provider_bad_status', { statusCode: 500 });
    expect(await refresh.execute()).toEqual({ outcome: 'failed', code: 'provider_bad_status' });
    expect(failures.records[1]).toEqual({
      at: clock.now(),
      code: 'provider_bad_status',
      statusCode: 500,
    });
  });

  it.each([
    ['a missing rate type', () => sampleQuotes().slice(1)],
    [
      'an invalid zero price',
      () => sampleQuotes().map((q, i) => (i === 0 ? { ...q, buy: 0n } : q)),
    ],
    ['a duplicate type', () => [...sampleQuotes(), ...sampleQuotes().slice(2, 3)]],
  ])(
    '%s yields provider_invalid_payload, stores nothing and keeps the old rows',
    async (_name, build) => {
      await seedOldRates();
      const before = [...rates.rows];
      provider.quotes = build();

      const result = await refresh.execute();

      expect(result).toEqual({ outcome: 'failed', code: 'provider_invalid_payload' });
      expect(rates.rows).toEqual(before);
      expect(rates.replaceCalls).toBe(0);
      expect(failures.records).toHaveLength(1);
      expect(failures.records[0]?.code).toBe('provider_invalid_payload');
      expect(failures.records[0]?.detail).toBeTypeOf('string');
      expect(schedule.nextAttemptAt).toEqual(new Date(clock.now().getTime() + 5 * MINUTE));
    },
  );

  it('a storage error is rethrown and records no provider failure', async () => {
    const boom = new Error('db down');
    rates.replaceError = boom;

    await expect(refresh.execute()).rejects.toBe(boom);
    expect(failures.records).toEqual([]);
    expect(schedule.consecutiveFailures).toBe(0);
  });

  it('a non-provider error from the provider is rethrown with no failure record', async () => {
    const boom = new TypeError('bug');
    provider.error = boom;

    await expect(refresh.execute()).rejects.toBe(boom);
    expect(failures.records).toEqual([]);
  });
});

describe('GetLatestRates', () => {
  it('returns the stored rows in RATE_TYPES order', async () => {
    const rates = new InMemoryRateRepository();
    await rates.replaceAll([...sampleQuotes()].reverse(), new Date('2026-10-02T12:00:00.000Z'));

    const result = await new GetLatestRates({ rates }).execute();

    expect(result.map((r) => r.rateType)).toEqual([...RATE_TYPES]);
  });

  it('returns an empty list when none exist', async () => {
    expect(await new GetLatestRates({ rates: new InMemoryRateRepository() }).execute()).toEqual([]);
  });

  it('has no provider in its constructor and calls none', async () => {
    const provider = new ScriptedRateProvider();
    const rates = new InMemoryRateRepository();
    const use = new GetLatestRates({ rates });
    await use.execute();

    const deps = (use as unknown as { deps: object }).deps;
    expect(Object.keys(deps)).toEqual(['rates']);
    expect(provider.calls).toBe(0);
  });
});
