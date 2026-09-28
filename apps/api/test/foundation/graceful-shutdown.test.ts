import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/shared/logging/logger';
import { SHUTDOWN_TIMEOUT_MS, createShutdown } from '../../src/shared/process/graceful-shutdown';

const logger = createLogger({ level: 'silent' });

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createShutdown', () => {
  it('closes once and exits 0', async () => {
    let closes = 0;
    const exits: number[] = [];
    const shutdown = createShutdown({
      name: 'worker',
      logger,
      close: () => {
        closes += 1;
        return Promise.resolve();
      },
      exit: (code) => {
        exits.push(code);
      },
    });

    shutdown('SIGTERM');
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

  it('exits 1 at once on a second signal while closing, without closing twice', async () => {
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
    expect(exits).toEqual([1]);

    closing.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(closes).toBe(1);
    expect(exits).toEqual([1]);
  });

  it('exits 1 when closing takes longer than 10 s', async () => {
    vi.useFakeTimers();
    const exits: number[] = [];
    const shutdown = createShutdown({
      name: 'api',
      logger,
      close: () => new Promise<void>(() => undefined),
      exit: (code) => {
        exits.push(code);
      },
    });

    expect(SHUTDOWN_TIMEOUT_MS).toBe(10_000);
    shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS - 1);
    expect(exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(exits).toEqual([1]);
  });

  it('does not exit 1 at the deadline after a close that finished in time', async () => {
    vi.useFakeTimers();
    const exits: number[] = [];
    const shutdown = createShutdown({
      name: 'api',
      logger,
      close: () => Promise.resolve(),
      exit: (code) => {
        exits.push(code);
      },
    });

    shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS * 2);
    expect(exits).toEqual([0]);
  });
});
