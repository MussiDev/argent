import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type {
  DeletionGrant,
  DeletionGrantPurger,
  DeletionGrantRepository,
} from '../../application/ports/deletion-grant-repository';
import { deletionGrants, type IdentityDb } from './schema';

export class DrizzleDeletionGrantRepository
  implements DeletionGrantRepository, DeletionGrantPurger
{
  constructor(private readonly db: IdentityDb) {}

  async replace(grant: DeletionGrant): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Delete-then-insert under READ COMMITTED lets concurrent calls each insert; serialize per user.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${grant.userId}))`);
      await tx.delete(deletionGrants).where(eq(deletionGrants.userId, grant.userId));
      await tx.insert(deletionGrants).values(grant);
    });
  }

  async findLive(
    tokenHash: string,
    userId: string,
    sessionFamilyId: string,
    credentialsVersion: number,
    now: Date,
  ): Promise<DeletionGrant | null> {
    const [grant] = await this.db
      .select({
        tokenHash: deletionGrants.tokenHash,
        userId: deletionGrants.userId,
        sessionFamilyId: deletionGrants.sessionFamilyId,
        credentialsVersion: deletionGrants.credentialsVersion,
        expiresAt: deletionGrants.expiresAt,
      })
      .from(deletionGrants)
      .where(
        and(
          eq(deletionGrants.tokenHash, tokenHash),
          eq(deletionGrants.userId, userId),
          eq(deletionGrants.sessionFamilyId, sessionFamilyId),
          eq(deletionGrants.credentialsVersion, credentialsVersion),
          gt(deletionGrants.expiresAt, now),
        ),
      )
      .limit(1);
    return grant ?? null;
  }

  async purgeExpired(now: Date): Promise<number> {
    const result = await this.db.delete(deletionGrants).where(lte(deletionGrants.expiresAt, now));
    return result.rowCount ?? 0;
  }
}
