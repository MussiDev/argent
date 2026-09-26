import { and, eq, lt, sql } from 'drizzle-orm';
import type {
  AttemptLimiter,
  AttemptPolicy,
  AttemptResult,
} from '../../application/ports/attempt-limiter';
import type { AttemptPurger } from '../../application/ports/attempt-purger';
import type { Clock } from '../../application/ports/clock';
import { authAttempts, type IdentityDb } from './schema';

/**
 * Fixed windows aligned to the Unix epoch, so every API instance maps the same instant to the same
 * `window_start` without coordinating (NFR-09).
 */
function windowStart(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

export class PostgresAttemptLimiter implements AttemptLimiter, AttemptPurger {
  constructor(
    private readonly db: IdentityDb,
    private readonly clock: Clock,
  ) {}

  async isLimitReached(policy: AttemptPolicy, key: string): Promise<boolean> {
    const [row] = await this.db
      .select({ count: authAttempts.count })
      .from(authAttempts)
      .where(
        and(
          eq(authAttempts.kind, policy.kind),
          eq(authAttempts.key, key),
          eq(authAttempts.windowStart, windowStart(this.clock.now(), policy.windowSeconds)),
        ),
      )
      .limit(1);
    return (row?.count ?? 0) >= policy.limit;
  }

  /** A single upsert, so concurrent attempts from several instances never lose an increment. */
  async record(policy: AttemptPolicy, key: string): Promise<AttemptResult> {
    const [row] = await this.db
      .insert(authAttempts)
      .values({
        kind: policy.kind,
        key,
        windowStart: windowStart(this.clock.now(), policy.windowSeconds),
        count: 1,
      })
      .onConflictDoUpdate({
        target: [authAttempts.kind, authAttempts.key, authAttempts.windowStart],
        set: { count: sql`${authAttempts.count} + 1` },
      })
      .returning({ count: authAttempts.count });
    if (!row) throw new Error('Upsert into auth_attempts returned no row');
    return { count: row.count, allowed: row.count <= policy.limit };
  }

  /** Deletes windows that started before `cutoff` (the worker purges rows older than 24 h). */
  async purgeOlderThan(cutoff: Date): Promise<number> {
    const result = await this.db.delete(authAttempts).where(lt(authAttempts.windowStart, cutoff));
    return result.rowCount ?? 0;
  }
}
