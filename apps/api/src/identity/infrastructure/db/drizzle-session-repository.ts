import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type {
  NewSession,
  Session,
  SessionRepository,
} from '../../application/ports/session-repository';
import { sessions, type IdentityDb } from './schema';

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: IdentityDb) {}

  async create({ familyId, ...session }: NewSession): Promise<Session> {
    const id = randomUUID();
    const [created] = await this.db
      .insert(sessions)
      .values({ id, familyId: familyId ?? id, ...session })
      .returning();
    if (!created) throw new Error('Insert into sessions returned no row');
    return created;
  }

  async findById(id: string): Promise<Session | null> {
    const [session] = await this.db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return session ?? null;
  }

  async findByRefreshTokenHash(refreshTokenHash: string): Promise<Session | null> {
    const [session] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, refreshTokenHash))
      .limit(1);
    return session ?? null;
  }

  /**
   * `revoked_at is null` is re-evaluated after waiting for a concurrent writer's row lock, so under
   * READ COMMITTED only the first of two concurrent claims matches the row.
   */
  async markReplaced(id: string, replacedBy: string, at: Date): Promise<boolean> {
    const claimed = await this.db
      .update(sessions)
      .set({ revokedAt: at, replacedBy })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return claimed.length === 1;
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: at })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: at })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: at })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }
}
