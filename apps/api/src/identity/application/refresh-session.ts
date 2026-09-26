import { isSessionLive } from './get-current-session';
import type { AccessTokenIssuer } from './ports/access-token-issuer';
import type { Clock } from './ports/clock';
import type { SessionRepository } from './ports/session-repository';
import type { TokenGenerator } from './ports/token-generator';
import type { UnitOfWork } from './ports/unit-of-work';
import type { SessionTokens } from './sign-in';

export interface RefreshSessionDependencies {
  sessions: SessionRepository;
  tokenGenerator: TokenGenerator;
  accessTokens: AccessTokenIssuer;
  unitOfWork: UnitOfWork;
  clock: Clock;
}

/**
 * `reused`: an already rotated token came back, so a copy exists somewhere and the whole family
 * was revoked (R-15). `rejected`: unknown token, a session revoked by sign-out or sign-out-all, or
 * a session idle too long. Both answer 401.
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
        });
        if (!(await sessions.markReplaced(current.id, successor.id, now))) {
          throw new RotationAlreadyClaimed();
        }
        return successor.id;
      });
    } catch (error) {
      // A concurrent request rotated this token first: the same token was used twice.
      if (!(error instanceof RotationAlreadyClaimed)) throw error;
      return this.reuse(current.userId, current.familyId, now);
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
