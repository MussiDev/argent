import { RateProviderFailure, type RateProviderFailureCode } from '../domain/errors';
import { assertCompleteQuotes } from '../domain/rate-quote';
import type { Clock } from './ports/clock';
import type { RateProvider } from './ports/rate-provider';
import type { RateRepository } from './ports/rate-repository';
import type { RefreshFailureLog } from './ports/refresh-failure-log';
import type { RefreshSchedule } from './ports/refresh-schedule';

export const REFRESH_INTERVAL_MS = 3_600_000;
export const RETRY_DELAY_MS = 300_000;
export const LEASE_MS = 300_000;

export interface RefreshRatesDependencies {
  provider: RateProvider;
  rates: RateRepository;
  schedule: RefreshSchedule;
  failures: RefreshFailureLog;
  clock: Clock;
}

export type RefreshOutcome =
  | { outcome: 'not_due' }
  | { outcome: 'refreshed' }
  | { outcome: 'failed'; code: RateProviderFailureCode };

export class RefreshRates {
  constructor(private readonly deps: RefreshRatesDependencies) {}

  async execute(): Promise<RefreshOutcome> {
    const { provider, rates, schedule, failures, clock } = this.deps;

    const lease = await schedule.claim(clock.now(), LEASE_MS);
    if (!lease) return { outcome: 'not_due' };

    try {
      const quotes = assertCompleteQuotes(await provider.fetchQuotes());
      const now = clock.now();
      await rates.replaceAll(quotes, now);
      await schedule.succeeded(lease, now, REFRESH_INTERVAL_MS);
      return { outcome: 'refreshed' };
    } catch (error) {
      // Only provider faults are recorded; storage errors propagate and the lease expiry retries.
      if (!(error instanceof RateProviderFailure)) throw error;
      const at = clock.now();
      await failures.record({
        at,
        code: error.code,
        ...(error.statusCode !== undefined && { statusCode: error.statusCode }),
        ...(error.detail !== undefined && { detail: error.detail }),
      });
      await schedule.failed(lease, at, RETRY_DELAY_MS);
      return { outcome: 'failed', code: error.code };
    }
  }
}
