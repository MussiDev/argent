import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  NewSession,
  Session,
  SessionRepository,
} from '../../application/ports/session-repository';
import { sessions, type IdentityDb } from './schema';

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: IdentityDb) {}

  async create(session: NewSession): Promise<Session> {
    const [created] = await this.db
      .insert(sessions)
      .values({ id: randomUUID(), ...session })
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

  async markReplaced(id: string, replacedBy: string, at: Date): Promise<void> {
    await this.db
      .update(sessions)
      // coalesce keeps the first revocation time if the session was already revoked.
      .set({ revokedAt: sql`coalesce(${sessions.revokedAt}, ${at})`, replacedBy })
      .where(eq(sessions.id, id));
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
