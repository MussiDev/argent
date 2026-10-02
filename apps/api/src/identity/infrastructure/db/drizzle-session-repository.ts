import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { SESSION_IDLE_LIMIT_MS } from '../../application/get-current-session';
import { Unauthenticated } from '../../domain/errors';
import type {
  NewSession,
  Session,
  SessionRepository,
} from '../../application/ports/session-repository';
import { sessions, type IdentityDb } from './schema';
import { violatedForeignKey } from './unique-violation';

const SESSIONS_USER_FOREIGN_KEY = 'sessions_user_id_users_id_fk';

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: IdentityDb) {}

  async create({ familyId, ...session }: NewSession): Promise<Session> {
    const id = randomUUID();
    const [created] = await this.db
      .insert(sessions)
      .values({ id, familyId: familyId ?? id, ...session })
      .returning()
      .catch((error: unknown) => {
        // The user was deleted between the caller's read and this insert (a refresh or a
        // verification racing a committed account deletion).
        if (violatedForeignKey(error) === SESSIONS_USER_FOREIGN_KEY) throw new Unauthenticated();
        throw error;
      });
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

  /** The rule of `isSessionLive`: unrevoked and used within the idle limit. */
  async isFamilyLive(familyId: string, now: Date): Promise<boolean> {
    const idleSince = new Date(now.getTime() - SESSION_IDLE_LIMIT_MS);
    const [live] = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.familyId, familyId),
          isNull(sessions.revokedAt),
          gt(sessions.lastUsedAt, idleSince),
        ),
      )
      .limit(1);
    return live !== undefined;
  }
}
