import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RATE_TYPES } from '@pesly/shared';
import { createRatesSyncJob } from '../../src/exchange-rates';
import { RefreshRates } from '../../src/exchange-rates/application/refresh-rates';
import { RateProviderFailure } from '../../src/exchange-rates/domain/errors';
import type { RateQuote } from '../../src/exchange-rates/domain/rate-quote';
import { DrizzleRefreshFailureLog } from '../../src/exchange-rates/infrastructure/db/drizzle-refresh-failure-log';
import {
  RATES_POLL_INTERVAL_MS,
  RatesSyncJob,
} from '../../src/exchange-rates/infrastructure/jobs/rates-sync-job';
import { FakeRateProvider } from '../../src/exchange-rates/infrastructure/provider/fake-rate-provider';
import { systemClock } from '../../src/exchange-rates/infrastructure/system-clock';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { logEntries } from '../helpers/identity-harness';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  InMemoryRateRepository,
  InMemoryRefreshFailureLog,
  InMemoryRefreshSchedule,
  MutableClock,
  ScriptedRateProvider,
} from './fakes';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function capturingLogger() {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  return { lines, logger };
}

async function storedRateTypes(): Promise<string[]> {
  const result = await connection.pool.query<{ rate_type: string }>(
    'select rate_type from exchange_rates order by rate_type',
  );
  return result.rows.map((row) => row.rate_type);
}

async function failureCount(): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    'select count(*) as n from exchange_rate_refresh_failures',
  );
  return Number(result.rows[0]?.n);
}

async function eventually(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(check()).toBe(true);
}

describe('RatesSyncJob', () => {
  it('polls every 30 seconds', () => {
    expect(RATES_POLL_INTERVAL_MS).toBe(30_000);
  });

  it('a pass with a due schedule and the fake provider stores 7 rates', async () => {
    const { lines, logger } = capturingLogger();
    const job = createRatesSyncJob({ db: connection.db, provider: new FakeRateProvider(), logger });

    const outcome = await job.runOnce();

    expect(outcome).toEqual({ outcome: 'refreshed' });
    expect(await storedRateTypes()).toEqual([...RATE_TYPES].sort());
    expect(logEntries(lines).map((entry) => entry.msg)).toContain('rates refreshed');
    expect(lines.join('')).not.toMatch(/15350000/);
  });

  it('a pass with an unreachable provider keeps the previous rates and records the failure', async () => {
    const { lines, logger } = capturingLogger();
    const clock = new MutableClock();
    const provider = new FakeRateProvider();
    const job = createRatesSyncJob({ db: connection.db, provider, logger, clock });
    await job.runOnce();
    const query = 'select rate_type, buy, sell, fetched_at from exchange_rates order by rate_type';
    const before = await connection.pool.query(query);

    clock.advance(60 * MINUTE);
    provider.failWith(
      new RateProviderFailure('provider_timeout', { detail: 'secret provider text' }),
    );
    const outcome = await job.runOnce();

    expect(outcome).toEqual({ outcome: 'failed', code: 'provider_timeout' });
    expect((await connection.pool.query(query)).rows).toEqual(before.rows);
    expect(await failureCount()).toBe(1);
    const failed = logEntries(lines).find((entry) => entry.msg === 'rates refresh failed');
    expect(failed).toMatchObject({ code: 'provider_timeout' });
    expect(lines.join('')).not.toContain('secret provider text');
  });

  it('with a mutable clock, no refresh runs at 59 minutes after a success and one runs at 60', async () => {
    const clock = new MutableClock();
    const provider = new ScriptedRateProvider();
    const job = createRatesSyncJob({
      db: connection.db,
      provider,
      logger: capturingLogger().logger,
      clock,
    });

    expect(await job.runOnce()).toEqual({ outcome: 'refreshed' });
    clock.advance(59 * MINUTE);
    expect(await job.runOnce()).toEqual({ outcome: 'not_due' });
    expect(provider.calls).toBe(1);
    clock.advance(MINUTE);
    expect(await job.runOnce()).toEqual({ outcome: 'refreshed' });
    expect(provider.calls).toBe(2);
  });

  it('two jobs running the same pass concurrently trigger exactly one provider call', async () => {
    const provider = new ScriptedRateProvider();
    const clock = new MutableClock();
    const { logger } = capturingLogger();
    const first = createRatesSyncJob({ db: connection.db, provider, logger, clock });
    const second = createRatesSyncJob({ db: connection.db, provider, logger, clock });

    const outcomes = await Promise.all([first.runOnce(), second.runOnce()]);

    expect(provider.calls).toBe(1);
    expect(outcomes.map((o) => o.outcome).sort()).toEqual(['not_due', 'refreshed']);
  });

  it('the failure-log purge removes records older than 30 days, keeps newer ones, and runs at most hourly', async () => {
    const clock = new MutableClock();
    const log = new DrizzleRefreshFailureLog(connection.db);
    const now = clock.now().getTime();
    await log.record({ at: new Date(now - 31 * DAY), code: 'provider_timeout' });
    await log.record({ at: new Date(now - 29 * DAY), code: 'provider_timeout' });
    const job = createRatesSyncJob({
      db: connection.db,
      provider: new ScriptedRateProvider(),
      logger: capturingLogger().logger,
      clock,
    });

    await job.runOnce();
    expect(await failureCount()).toBe(1);

    await log.record({ at: new Date(now - 32 * DAY), code: 'provider_timeout' });
    clock.advance(59 * MINUTE);
    await job.runOnce();
    expect(await failureCount()).toBe(2);

    clock.advance(MINUTE);
    await job.runOnce();
    expect(await failureCount()).toBe(1);
  });

  describe('with in-memory ports', () => {
    function build(provider: ScriptedRateProvider) {
      const rates = new InMemoryRateRepository();
      const schedule = new InMemoryRefreshSchedule();
      const failures = new InMemoryRefreshFailureLog();
      const clock = new MutableClock();
      const { lines, logger } = capturingLogger();
      const refresh = new RefreshRates({ provider, rates, schedule, failures, clock });
      const job = new RatesSyncJob({ refresh, failures, clock, logger, pollIntervalMs: 5 });
      return { job, rates, schedule, lines };
    }

    it('a storage error in a pass is logged and the next pass runs', async () => {
      const provider = new ScriptedRateProvider();
      const { job, rates, schedule, lines } = build(provider);
      rates.replaceError = new Error('connection lost');
      const originalReplace = rates.replaceAll.bind(rates);
      rates.replaceAll = async (...args) => {
        try {
          await originalReplace(...args);
        } catch (error) {
          // The storage outage ends; the failed pass left its lease, so make the next tick due.
          rates.replaceError = null;
          schedule.nextAttemptAt = null;
          throw error;
        }
      };

      job.start();
      await eventually(() => rates.rows.length === 7);
      await job.stop();

      expect(logEntries(lines).some((e) => e.msg === 'rates refresh errored')).toBe(true);
      expect(provider.calls).toBeGreaterThanOrEqual(2);
    });

    it('stop() during a refresh lets the statement in flight finish and makes no further provider call', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const provider = new ScriptedRateProvider();
      const fetchQuotes = provider.fetchQuotes.bind(provider);
      provider.fetchQuotes = async (): Promise<RateQuote[]> => {
        const quotes = await fetchQuotes();
        await gate;
        return quotes;
      };
      const { job, rates, schedule } = build(provider);

      job.start();
      await eventually(() => provider.calls === 1);
      const stopping = job.stop();
      release();
      await stopping;

      expect(rates.rows).toHaveLength(7);
      expect(schedule.lastSuccessAt).not.toBeNull();
      schedule.nextAttemptAt = null;
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(provider.calls).toBe(1);
    });
  });

  it('exposes a real system clock', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1000);
  });
});
