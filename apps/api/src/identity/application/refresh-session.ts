import { isSessionLive } from './get-current-session';
import type { AccessTokenIssuer } from './ports/access-token-issuer';
import type { Clock } from './ports/clock';
import type { SessionRepository } from './ports/session-repository';
import type { TokenGenerator } from './ports/token-generator';
import type { UnitOfWork } from './ports/unit-of-work';
import type { UserRepository } from './ports/user-repository';
import type { SessionTokens } from './start-session';

export interface RefreshSessionDependencies {
  sessions: SessionRepository;
  users: UserRepository;
  tokenGenerator: TokenGenerator;
  accessTokens: AccessTokenIssuer;
  unitOfWork: UnitOfWork;
  clock: Clock;
}

/**
 * `reused`: an already rotated token came back, so a copy exists somewhere and the whole family
 * was revoked (R-15). `rejected`: unknown token, a session revoked by sign-out or sign-out-all
 * (including one that races this refresh), a session idle too long, or one created before the
 * user's last password change. All answer 401.
 */
export type RefreshSessionResult =
  | { outcome: 'rotated'; userId: string; previousSessionId: string; session: SessionTokens }
  | { outcome: 'reused'; userId: string; familyId: string }
  | { outcome: 'rejected' };

/** Thrown inside the rotation transaction to roll back the successor when the claim is lost. */
class RotationAlreadyClaimed extends Error {
  constructor() {
    super('Refresh rotation already claimed');
    this.name = 'RotationAlreadyClaimed';
  }
}

export class RefreshSession {
  constructor(private readonly deps: RefreshSessionDependencies) {}

  async execute(refreshToken: string | undefined): Promise<RefreshSessionResult> {
    if (!refreshToken) return { outcome: 'rejected' };
    const current = await this.deps.sessions.findByRefreshTokenHash(
      this.deps.tokenGenerator.hash(refreshToken),
    );
    if (!current) return { outcome: 'rejected' };

    const now = this.deps.clock.now();
    if (current.revokedAt !== null) {
      // Only a rotated token proves a copy exists; a signed-out one is simply over.
      return current.replacedBy !== null
        ? this.reuse(current.userId, current.familyId, now)
        : { outcome: 'rejected' };
    }
    if (!isSessionLive(current, now)) return { outcome: 'rejected' };
    // A session that survived a reset (it was committed concurrently with it) is dead (AC-10).
    const user = await this.deps.users.findById(current.userId);
    if (!user || user.credentialsVersion !== current.credentialsVersion) {
      return { outcome: 'rejected' };
    }

    const nextRefreshToken = this.deps.tokenGenerator.generate();
    let successorId: string;
    try {
      // The claim and the successor commit together: a lost claim leaves no successor behind.
      successorId = await this.deps.unitOfWork.run(async ({ sessions }) => {
        const successor = await sessions.create({
          userId: current.userId,
          familyId: current.familyId,
          refreshTokenHash: this.deps.tokenGenerator.hash(nextRefreshToken),
          lastUsedAt: now,
          // Inherited, never re-read: a successor committed after a reset stays as dead as its
          // predecessor.
          credentialsVersion: current.credentialsVersion,
        });
        if (!(await sessions.markReplaced(current.id, successor.id, now))) {
          throw new RotationAlreadyClaimed();
        }
        return successor.id;
      });
    } catch (error) {
      if (!(error instanceof RotationAlreadyClaimed)) throw error;
      // Another writer revoked the session first. Only a concurrent rotation proves the token was
      // used twice; a sign-out, sign-out-all or reset leaves no successor and simply ends it.
      const claimed = await this.deps.sessions.findById(current.id);
      return claimed?.replacedBy
        ? this.reuse(current.userId, current.familyId, now)
        : { outcome: 'rejected' };
    }

    const accessToken = await this.deps.accessTokens.issue({
      userId: current.userId,
      sessionId: successorId,
    });
    return {
      outcome: 'rotated',
      userId: current.userId,
      previousSessionId: current.id,
      session: {
        sessionId: successorId,
        accessToken,
        refreshToken: nextRefreshToken,
        accessTokenTtlSeconds: this.deps.accessTokens.ttlSeconds,
      },
    };
  }

  private async reuse(userId: string, familyId: string, now: Date): Promise<RefreshSessionResult> {
    await this.deps.sessions.revokeFamily(familyId, now);
    return { outcome: 'reused', userId, familyId };
  }
}
