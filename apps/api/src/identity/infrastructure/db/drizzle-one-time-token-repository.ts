import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type {
  ConsumedOneTimeToken,
  NewOneTimeToken,
  OneTimeTokenPurpose,
  OneTimeTokenRepository,
} from '../../application/ports/one-time-token-repository';
import { oneTimeTokens, type IdentityDb } from './schema';

export class DrizzleOneTimeTokenRepository implements OneTimeTokenRepository {
  constructor(private readonly db: IdentityDb) {}

  async create(token: NewOneTimeToken): Promise<void> {
    await this.db.insert(oneTimeTokens).values({ id: randomUUID(), ...token });
  }

  /**
   * One conditional UPDATE: PostgreSQL re-checks `used_at is null` after taking the row lock, so
   * of two concurrent consumptions exactly one gets the row back (single use, NFR-04).
   */
  async consume(
    tokenHash: string,
    purpose: OneTimeTokenPurpose,
    now: Date,
  ): Promise<ConsumedOneTimeToken | null> {
    const [consumed] = await this.db
      .update(oneTimeTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(oneTimeTokens.tokenHash, tokenHash),
          eq(oneTimeTokens.purpose, purpose),
          isNull(oneTimeTokens.usedAt),
          gt(oneTimeTokens.expiresAt, now),
        ),
      )
      .returning({ id: oneTimeTokens.id, userId: oneTimeTokens.userId });
    return consumed ?? null;
  }

  /**
   * Transaction-scoped advisory lock keyed by (user, purpose): released automatically at commit or
   * rollback. A hash collision only serializes two unrelated issuers, which is harmless.
   */
  async lockIssuance(userId: string, purpose: OneTimeTokenPurpose): Promise<void> {
    await this.db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${purpose}:${userId}`}, 0))`,
    );
  }

  async invalidateUnused(userId: string, purpose: OneTimeTokenPurpose, now: Date): Promise<void> {
    await this.db
      .update(oneTimeTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(oneTimeTokens.userId, userId),
          eq(oneTimeTokens.purpose, purpose),
          isNull(oneTimeTokens.usedAt),
        ),
      );
  }
}
