import type { AccessTokenIssuer } from './ports/access-token-issuer';
import type { Clock } from './ports/clock';
import type { SessionRepository } from './ports/session-repository';
import type { TokenGenerator } from './ports/token-generator';

export interface SignOutDependencies {
  sessions: SessionRepository;
  tokenGenerator: TokenGenerator;
  accessTokens: AccessTokenIssuer;
  clock: Clock;
}

export interface SignOutInput {
  accessToken: string | undefined;
  refreshToken: string | undefined;
}

/** For logging only: sign-out always succeeds (idempotent). */
export interface SignOutResult {
  userId: string | null;
  sessionIds: string[];
}

export class SignOut {
  constructor(private readonly deps: SignOutDependencies) {}

  /**
   * Revokes the session named by the refresh cookie and the one named by the access token (the
   * same one in a normal browser). The refresh cookie alone is enough, so a user whose access
   * token already expired can still sign out. Unknown or invalid tokens are ignored.
   */
  async execute({ accessToken, refreshToken }: SignOutInput): Promise<SignOutResult> {
    const now = this.deps.clock.now();
    const sessionIds = new Set<string>();
    let userId: string | null = null;

    if (refreshToken) {
      const session = await this.deps.sessions.findByRefreshTokenHash(
        this.deps.tokenGenerator.hash(refreshToken),
      );
      if (session) {
        sessionIds.add(session.id);
        userId = session.userId;
      }
    }
    if (accessToken) {
      const claims = await this.deps.accessTokens.verify(accessToken);
      if (claims) {
        sessionIds.add(claims.sessionId);
        userId ??= claims.userId;
      }
    }

    for (const sessionId of sessionIds) await this.deps.sessions.revoke(sessionId, now);
    return { userId, sessionIds: [...sessionIds] };
  }
}
