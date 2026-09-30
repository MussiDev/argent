import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type {
  TwoFactorRepository,
  TwoFactorSettings,
} from '../../application/ports/two-factor-repository';
import { userTwoFactor, type IdentityDb } from './schema';

export class DrizzleTwoFactorRepository implements TwoFactorRepository {
  constructor(private readonly db: IdentityDb) {}

  async findByUserId(userId: string): Promise<TwoFactorSettings | null> {
    const [settings] = await this.db
      .select()
      .from(userTwoFactor)
      .where(eq(userTwoFactor.userId, userId))
      .limit(1);
    return settings ?? null;
  }

  /**
   * One upsert whose update only applies while `enabled_at is null`: an enabled row is never
   * replaced, even by a setup racing the enable (threat R-52).
   */
  async savePending(userId: string, sealed: string): Promise<boolean> {
    const saved = await this.db
      .insert(userTwoFactor)
      .values({ userId, secretSealed: sealed })
      .onConflictDoUpdate({
        target: userTwoFactor.userId,
        set: { secretSealed: sql`excluded.secret_sealed` },
        setWhere: isNull(userTwoFactor.enabledAt),
      })
      .returning({ userId: userTwoFactor.userId });
    return saved.length > 0;
  }

  async activate(userId: string, sealed: string, at: Date): Promise<boolean> {
    const activated = await this.db
      .update(userTwoFactor)
      .set({ enabledAt: at })
      .where(
        and(
          eq(userTwoFactor.userId, userId),
          isNull(userTwoFactor.enabledAt),
          eq(userTwoFactor.secretSealed, sealed),
        ),
      )
      .returning({ userId: userTwoFactor.userId });
    return activated.length > 0;
  }

  /** The condition is re-checked after a concurrent writer's row lock, so a step is used once. */
  async advanceLastUsedStep(userId: string, step: number): Promise<boolean> {
    const advanced = await this.db
      .update(userTwoFactor)
      .set({ lastUsedStep: step })
      .where(and(eq(userTwoFactor.userId, userId), lt(userTwoFactor.lastUsedStep, step)))
      .returning({ userId: userTwoFactor.userId });
    return advanced.length > 0;
  }

  async delete(userId: string): Promise<void> {
    await this.db.delete(userTwoFactor).where(eq(userTwoFactor.userId, userId));
  }
}
