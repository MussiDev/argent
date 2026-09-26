import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/shared/logging/logger';
import { createShutdown } from '../../src/shared/process/graceful-shutdown';

const logger = createLogger({ level: 'silent' });

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('createShutdown', () => {
  it('closes once and exits 0, ignoring further signals', async () => {
    const closing = deferred();
    let closes = 0;
    const exits: number[] = [];
    const shutdown = createShutdown({
      name: 'worker',
      logger,
      close: () => {
        closes += 1;
        return closing.promise;
      },
      exit: (code) => {
        exits.push(code);
      },
    });

    shutdown('SIGTERM');
    shutdown('SIGINT');
    closing.resolve();
    await expect.poll(() => exits).toEqual([0]);

    shutdown('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(closes).toBe(1);
    expect(exits).toEqual([0]);
  });

  it('exits 1 when closing fails', async () => {
    const exits: number[] = [];
    const shutdown = createShutdown({
      name: 'worker',
      logger,
      close: () => Promise.reject(new Error('pool already ended')),
      exit: (code) => {
        exits.push(code);
      },
    });

    shutdown('SIGTERM');

    await expect.poll(() => exits).toEqual([1]);
  });
});
