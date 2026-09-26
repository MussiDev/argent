import type { Logger } from '../logging/logger';

export interface ShutdownOptions {
  /** Process name for the log lines, e.g. `api` or `email worker`. */
  name: string;
  logger: Logger;
  /** Releases resources (server, worker, database pool). Called at most once. */
  close: () => Promise<void>;
  exit?: (code: number) => void;
}

/**
 * A signal handler that closes the process once: a second SIGTERM/SIGINT while closing is
 * ignored, so resources such as the database pool are never ended twice.
 */
export function createShutdown({
  name,
  logger,
  close,
  exit = (code) => process.exit(code),
}: ShutdownOptions): (signal: string) => void {
  let closing = false;
  return (signal) => {
    if (closing) {
      logger.info({ signal }, `${name} already shutting down`);
      return;
    }
    closing = true;
    logger.info({ signal }, `${name} shutting down`);
    close().then(
      () => {
        exit(0);
      },
      (error: unknown) => {
        logger.error({ err: error }, `error while shutting down the ${name}`);
        exit(1);
      },
    );
  };
}
