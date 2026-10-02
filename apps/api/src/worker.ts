import {
  DolarapiRateProvider,
  FakeRateProvider,
  createRatesSyncJob,
  type RateProvider,
} from './exchange-rates';
import { createEmailTransport, createEmailWorker } from './identity';
import { parseWorkerEnv } from './shared/config/env';
import { createDatabase } from './shared/db/client';
import { createLogger } from './shared/logging/logger';
import { createShutdown } from './shared/process/graceful-shutdown';

/**
 * Worker process: delivers the PostgreSQL outbox through the transport named by EMAIL_PROVIDER and
 * refreshes the exchange rates through the provider named by RATE_PROVIDER. Run as many as needed;
 * row locks keep them from sending an email twice and the refresh claim keeps the provider calls
 * to one per hour.
 */
const env = parseWorkerEnv(process.env);
const logger = createLogger({ level: env.LOG_LEVEL });
const { db, pool } = createDatabase(env.DATABASE_URL);
const worker = createEmailWorker({
  db,
  env,
  logger,
  transport: createEmailTransport(env, logger),
});

const rateProvider: RateProvider =
  env.RATE_PROVIDER === 'fake'
    ? new FakeRateProvider()
    : new DolarapiRateProvider({ baseUrl: env.DOLARAPI_BASE_URL });
const ratesJob = createRatesSyncJob({ db, provider: rateProvider, logger });

worker.start();
logger.info({ provider: env.EMAIL_PROVIDER }, 'email worker started');
ratesJob.start();
logger.info({ provider: env.RATE_PROVIDER }, 'rates sync started');

const shutdown = createShutdown({
  name: 'email worker',
  logger,
  close: async () => {
    await Promise.all([worker.stop(), ratesJob.stop()]);
    await pool.end();
  },
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
