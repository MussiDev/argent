import { and, count, eq, isNull } from 'drizzle-orm';
import type {
  RecoveryCodeRepository,
  StoredRecoveryCode,
} from '../../application/ports/recovery-code-repository';
import { recoveryCodes, type IdentityDb } from './schema';

export class DrizzleRecoveryCodeRepository implements RecoveryCodeRepository {
  constructor(private readonly db: IdentityDb) {}

  /** A transaction, or a savepoint when already inside one, so old and new codes never mix. */
  async replaceAll(userId: string, hashes: readonly string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      if (hashes.length === 0) return;
      await tx.insert(recoveryCodes).values(hashes.map((codeHash) => ({ userId, codeHash })));
    });
  }

  findUnused(userId: string): Promise<StoredRecoveryCode[]> {
    return this.db
      .select()
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  }

  async markUsed(id: string, at: Date): Promise<boolean> {
    const marked = await this.db
      .update(recoveryCodes)
      .set({ usedAt: at })
      .where(and(eq(recoveryCodes.id, id), isNull(recoveryCodes.usedAt)))
      .returning({ id: recoveryCodes.id });
    return marked.length > 0;
  }

  async countUnused(userId: string): Promise<number> {
    const [result] = await this.db
      .select({ n: count() })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
    return result?.n ?? 0;
  }

  async deleteAll(userId: string): Promise<void> {
    await this.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  }
}
