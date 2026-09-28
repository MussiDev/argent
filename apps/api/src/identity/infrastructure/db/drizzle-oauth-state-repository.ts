import { and, eq, gt, lte } from 'drizzle-orm';
import type { OAuthStatePurger } from '../../application/ports/oauth-state-purger';
import type {
  NewOAuthState,
  OAuthState,
  OAuthStateRepository,
} from '../../application/ports/oauth-state-repository';
import { oauthStates, type IdentityDb } from './schema';

export class DrizzleOAuthStateRepository implements OAuthStateRepository, OAuthStatePurger {
  constructor(private readonly db: IdentityDb) {}

  async create(state: NewOAuthState): Promise<void> {
    await this.db.insert(oauthStates).values(state);
  }

  /** One `delete ... returning`: of two concurrent consumes of one state, only one gets the row. */
  async consume(stateHash: string, bindingHash: string, now: Date): Promise<OAuthState | null> {
    const [consumed] = await this.db
      .delete(oauthStates)
      .where(
        and(
          eq(oauthStates.stateHash, stateHash),
          eq(oauthStates.bindingHash, bindingHash),
          gt(oauthStates.expiresAt, now),
        ),
      )
      .returning();
    return consumed ?? null;
  }

  async purgeExpired(now: Date): Promise<number> {
    const result = await this.db.delete(oauthStates).where(lte(oauthStates.expiresAt, now));
    return result.rowCount ?? 0;
  }
}
