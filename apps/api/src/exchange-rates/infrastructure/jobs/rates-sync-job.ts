import type { Logger } from '../../../shared/logging/logger';
import type { Clock } from '../../application/ports/clock';
import type { RefreshFailureLog } from '../../application/ports/refresh-failure-log';
import type { RefreshOutcome, RefreshRates } from '../../application/refresh-rates';

export const RATES_POLL_INTERVAL_MS = 30_000;
const HOUR_MS = 60 * 60 * 1000;
const PURGE_INTERVAL_MS = HOUR_MS;
const FAILURE_RETENTION_MS = 30 * 24 * HOUR_MS;

export interface RatesSyncJobDependencies {
  refresh: Pick<RefreshRates, 'execute'>;
  failures: RefreshFailureLog;
  clock: Clock;
  logger: Logger;
  pollIntervalMs?: number;
}

/**
 * Polls the shared refresh schedule: every pass asks `RefreshRates` whether a refresh is due (the
 * claim is atomic, so any number of workers trigger one provider call per hour) and purges old
 * failure records at most once an hour. Logs carry outcomes and codes only, never provider text.
 */
export class RatesSyncJob {
  private readonly pollIntervalMs: number;
  private lastPurgeAt: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;
  private stopRequested = false;

  constructor(private readonly deps: RatesSyncJobDependencies) {
    this.pollIntervalMs = deps.pollIntervalMs ?? RATES_POLL_INTERVAL_MS;
  }

  /** One pass: the purge if due, then the refresh if due. A storage error propagates. */
  async runOnce(): Promise<RefreshOutcome> {
    await this.purgeIfDue();
    if (this.stopRequested) return { outcome: 'not_due' };
    const result = await this.deps.refresh.execute();
    if (result.outcome === 'refreshed') {
      this.deps.logger.info('rates refreshed');
    } else if (result.outcome === 'failed') {
      this.deps.logger.warn({ code: result.code }, 'rates refresh failed');
    }
    return result;
  }

  /** Polls every `pollIntervalMs` until `stop()`; a failed pass is logged and the next one runs. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.stopRequested = false;
    const tick = (): void => {
      this.running = this.runOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.deps.logger.error({ err: error }, 'rates refresh errored');
        })
        .finally(() => {
          if (!this.stopped) this.timer = setTimeout(tick, this.pollIntervalMs);
        });
    };
    tick();
  }

  /** Stops polling; the pass in progress finishes its current statement and starts no new call. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.stopRequested = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private async purgeIfDue(): Promise<void> {
    const now = this.deps.clock.now().getTime();
    if (this.lastPurgeAt !== undefined && now - this.lastPurgeAt < PURGE_INTERVAL_MS) return;
    this.lastPurgeAt = now;
    // A failed purge must not stop the refresh; it is retried at the next purge interval.
    try {
      const deleted = await this.deps.failures.purgeOlderThan(new Date(now - FAILURE_RETENTION_MS));
      this.deps.logger.debug({ deleted }, 'rate failure purge done');
    } catch (error) {
      this.deps.logger.error({ err: error }, 'rate failure purge failed');
    }
  }
}
