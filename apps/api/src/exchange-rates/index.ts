import type { Database } from '../shared/db/client';
import type { Logger } from '../shared/logging/logger';
import type { Clock } from './application/ports/clock';
import type { RateProvider } from './application/ports/rate-provider';
import { RefreshRates } from './application/refresh-rates';
import { DrizzleRateRepository } from './infrastructure/db/drizzle-rate-repository';
import { DrizzleRefreshFailureLog } from './infrastructure/db/drizzle-refresh-failure-log';
import { DrizzleRefreshSchedule } from './infrastructure/db/drizzle-refresh-schedule';
import { RatesSyncJob } from './infrastructure/jobs/rates-sync-job';
import { systemClock } from './infrastructure/system-clock';

export { DolarapiRateProvider } from './infrastructure/provider/dolarapi-rate-provider';
export { FakeRateProvider } from './infrastructure/provider/fake-rate-provider';
export type { RateProvider } from './application/ports/rate-provider';
export type { RatesSyncJob } from './infrastructure/jobs/rates-sync-job';

export interface RatesSyncJobFactoryDependencies {
  db: Database;
  provider: RateProvider;
  logger: Logger;
  clock?: Clock;
}

/** The rates sync job over the PostgreSQL repositories, schedule and failure log. */
export function createRatesSyncJob({
  db,
  provider,
  logger,
  clock = systemClock,
}: RatesSyncJobFactoryDependencies): RatesSyncJob {
  const failures = new DrizzleRefreshFailureLog(db);
  const refresh = new RefreshRates({
    provider,
    rates: new DrizzleRateRepository(db),
    schedule: new DrizzleRefreshSchedule(db),
    failures,
    clock,
  });
  return new RatesSyncJob({ refresh, failures, clock, logger });
}
