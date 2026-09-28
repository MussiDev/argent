import type { Logger } from '../logging/logger';

/** Closing the server, worker and pool must finish within this, or the process exits with 1. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

export interface ShutdownOptions {
  /** Process name for the log lines, e.g. `api` or `email worker`. */
  name: string;
  logger: Logger;
  /** Releases resources (server, worker, database pool). Called at most once. */
  close: () => Promise<void>;
  exit?: (code: number) => void;
}

/**
 * A signal handler that closes the process once and exits 0. It exits 1 instead when closing
 * fails, when it does not finish within `SHUTDOWN_TIMEOUT_MS`, or when a second SIGTERM/SIGINT
 * arrives while closing (the operator insists); resources are never closed twice.
 */
export function createShutdown({
  name,
  logger,
  close,
  exit = (code) => process.exit(code),
}: ShutdownOptions): (signal: string) => void {
  let closing = false;
  let exited = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const exitOnce = (code: number): void => {
    if (exited) return;
    exited = true;
    clearTimeout(deadline);
    exit(code);
  };

  return (signal) => {
    if (closing) {
      logger.warn({ signal }, `${name} received a second signal while shutting down; exiting`);
      exitOnce(1);
      return;
    }
    closing = true;
    logger.info({ signal }, `${name} shutting down`);
    deadline = setTimeout(() => {
      logger.error(`${name} did not shut down within ${SHUTDOWN_TIMEOUT_MS} ms; exiting`);
      exitOnce(1);
    }, SHUTDOWN_TIMEOUT_MS);
    // The deadline alone must not keep the process alive once everything else is closed.
    deadline.unref();
    close().then(
      () => {
        exitOnce(0);
      },
      (error: unknown) => {
        logger.error({ err: error }, `error while shutting down the ${name}`);
        exitOnce(1);
      },
    );
  };
}
