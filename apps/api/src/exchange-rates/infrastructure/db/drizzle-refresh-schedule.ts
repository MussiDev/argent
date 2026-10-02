import { and, eq, lte, sql } from 'drizzle-orm';
import type { RefreshSchedule } from '../../application/ports/refresh-schedule';
import type { Database } from '../../../shared/db/client';
import { exchangeRateSync } from './schema';

const SCHEDULE_ROW_ID = 1;

const after = (from: Date, ms: number) => new Date(from.getTime() + ms);

/** Times come from the callers' clock, never from the database clock. */
export class DrizzleRefreshSchedule implements RefreshSchedule {
  constructor(private readonly db: Database) {}

  async claim(now: Date, leaseMs: number): Promise<Date | null> {
    const lease = after(now, leaseMs);
    // One atomic upsert: it only writes when the row is absent or due, so of two simultaneous
    // claims exactly one gets a returned row.
    const claimed = await this.db
      .insert(exchangeRateSync)
      .values({ id: SCHEDULE_ROW_ID, nextAttemptAt: lease })
      .onConflictDoUpdate({
        target: exchangeRateSync.id,
        set: { nextAttemptAt: lease },
        setWhere: lte(exchangeRateSync.nextAttemptAt, now),
      })
      .returning({ id: exchangeRateSync.id });
    return claimed.length > 0 ? lease : null;
  }

  async succeeded(lease: Date, now: Date, intervalMs: number): Promise<void> {
    await this.db
      .update(exchangeRateSync)
      .set({
        nextAttemptAt: after(now, intervalMs),
        lastSuccessAt: now,
        consecutiveFailures: 0,
      })
      .where(this.ownedBy(lease));
  }

  async failed(lease: Date, now: Date, retryMs: number): Promise<void> {
    await this.db
      .update(exchangeRateSync)
      .set({
        nextAttemptAt: after(now, retryMs),
        consecutiveFailures: sql`${exchangeRateSync.consecutiveFailures} + 1`,
      })
      .where(this.ownedBy(lease));
  }

  /** A stale owner's lease no longer matches, so its update changes nothing. */
  private ownedBy(lease: Date) {
    return and(eq(exchangeRateSync.id, SCHEDULE_ROW_ID), eq(exchangeRateSync.nextAttemptAt, lease));
  }
}
