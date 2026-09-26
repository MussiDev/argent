import { createApp } from './app';
import { parseEnv } from './shared/config/env';
import { createLogger } from './shared/logging/logger';

const env = parseEnv(process.env);
const logger = createLogger({ level: env.LOG_LEVEL });
const app = createApp({ env, logger });

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'api listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'api shutting down');
  server.close((error) => {
    if (error) logger.error({ err: error }, 'error while closing the server');
    process.exit(error ? 1 : 0);
  });
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
