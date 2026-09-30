import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { SignInChallengePurger } from '../../application/ports/sign-in-challenge-purger';
import type {
  NewSignInChallenge,
  SignInChallenge,
  SignInChallengeRepository,
} from '../../application/ports/sign-in-challenge-repository';
import { signInChallenges, type IdentityDb } from './schema';

function live(tokenHash: string, now: Date) {
  return and(eq(signInChallenges.tokenHash, tokenHash), gt(signInChallenges.expiresAt, now));
}

export class DrizzleSignInChallengeRepository
  implements SignInChallengeRepository, SignInChallengePurger
{
  constructor(private readonly db: IdentityDb) {}

  async create(challenge: NewSignInChallenge): Promise<void> {
    await this.db.insert(signInChallenges).values(challenge);
  }

  async findLive(tokenHash: string, now: Date): Promise<SignInChallenge | null> {
    const [challenge] = await this.db
      .select()
      .from(signInChallenges)
      .where(live(tokenHash, now))
      .limit(1);
    return challenge ?? null;
  }

  async lockLive(tokenHash: string, now: Date): Promise<SignInChallenge | null> {
    const [challenge] = await this.db
      .select()
      .from(signInChallenges)
      .where(live(tokenHash, now))
      .limit(1)
      .for('update');
    return challenge ?? null;
  }

  async recordAttempt(tokenHash: string): Promise<number> {
    const [updated] = await this.db
      .update(signInChallenges)
      .set({ attempts: sql`${signInChallenges.attempts} + 1` })
      .where(eq(signInChallenges.tokenHash, tokenHash))
      .returning({ attempts: signInChallenges.attempts });
    if (!updated) throw new Error('Sign-in challenge not found while recording an attempt');
    return updated.attempts;
  }

  /** One `delete ... returning`: of two concurrent consumes, only one gets the row. */
  async consume(tokenHash: string): Promise<boolean> {
    const consumed = await this.db
      .delete(signInChallenges)
      .where(eq(signInChallenges.tokenHash, tokenHash))
      .returning({ tokenHash: signInChallenges.tokenHash });
    return consumed.length > 0;
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.db.delete(signInChallenges).where(eq(signInChallenges.userId, userId));
  }

  async purgeExpired(now: Date): Promise<number> {
    const result = await this.db
      .delete(signInChallenges)
      .where(lte(signInChallenges.expiresAt, now));
    return result.rowCount ?? 0;
  }
}
