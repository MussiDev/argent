import { createEmailTransport, createEmailWorker } from './identity';
import { parseWorkerEnv } from './shared/config/env';
import { createDatabase } from './shared/db/client';
import { createLogger } from './shared/logging/logger';
import { createShutdown } from './shared/process/graceful-shutdown';

/**
 * Email worker process: delivers the PostgreSQL outbox through the transport named by
 * EMAIL_PROVIDER. Run as many as needed; row locks keep them from sending an email twice.
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

worker.start();
logger.info({ provider: env.EMAIL_PROVIDER }, 'email worker started');

const shutdown = createShutdown({
  name: 'email worker',
  logger,
  close: async () => {
    await worker.stop();
    await pool.end();
  },
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
