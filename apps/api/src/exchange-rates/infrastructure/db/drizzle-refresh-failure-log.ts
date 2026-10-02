import { lt } from 'drizzle-orm';
import type {
  RefreshFailureLog,
  RefreshFailureRecord,
} from '../../application/ports/refresh-failure-log';
import type { Database } from '../../../shared/db/client';
import { exchangeRateRefreshFailures } from './schema';

const DETAIL_MAX_CHARS = 200;

/** Counts code points like the database `char_length` check, so a failure record never throws. */
function truncated(detail: string | undefined): string | null {
  if (detail === undefined) return null;
  return Array.from(detail).slice(0, DETAIL_MAX_CHARS).join('');
}

export class DrizzleRefreshFailureLog implements RefreshFailureLog {
  constructor(private readonly db: Database) {}

  async record(failure: RefreshFailureRecord): Promise<void> {
    await this.db.insert(exchangeRateRefreshFailures).values({
      failedAt: failure.at,
      code: failure.code,
      statusCode: failure.statusCode ?? null,
      detail: truncated(failure.detail),
    });
  }

  async purgeOlderThan(cutoff: Date): Promise<number> {
    const deleted = await this.db
      .delete(exchangeRateRefreshFailures)
      .where(lt(exchangeRateRefreshFailures.failedAt, cutoff))
      .returning({ id: exchangeRateRefreshFailures.id });
    return deleted.length;
  }
}
