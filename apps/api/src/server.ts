import { createAccountRoutes } from './accounts';
import { createApp } from './app';
import { createCategoryRoutes, seedDefaultCategories } from './categories';
// Deep import on purpose: the exchange-rates barrel would load the providers and the sync job into the API process (NFR-03, R-08).
import { createExchangeRateRoutes } from './exchange-rates/infrastructure/http/exchange-rate-routes';
import { parseEnv } from './shared/config/env';
import { createDatabase } from './shared/db/client';
import { createLogger } from './shared/logging/logger';
import { createShutdown } from './shared/process/graceful-shutdown';

const env = parseEnv(process.env);
const logger = createLogger({ level: env.LOG_LEVEL });
const { db, pool } = createDatabase(env.DATABASE_URL);
const app = createApp({
  env,
  logger,
  // The composition root is the only place that knows both modules: new accounts get their default
  // categories in the transaction that creates them.
  identity: { db, onUserCreated: [seedDefaultCategories] },
  routerFactories: [
    createAccountRoutes({ db, logger }),
    createCategoryRoutes({ db, logger }),
    createExchangeRateRoutes({ db }),
  ],
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'api listening');
});

const shutdown = createShutdown({
  name: 'api',
  logger,
  close: async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await pool.end();
  },
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
