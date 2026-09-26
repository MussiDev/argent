import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
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
