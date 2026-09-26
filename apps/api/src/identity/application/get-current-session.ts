import type { AccessTokenIssuer } from './ports/access-token-issuer';
import type { Clock } from './ports/clock';
import type { Session, SessionRepository } from './ports/session-repository';
import type { User, UserRepository } from './ports/user-repository';

/** NFR-05: a session unused for 30 days is over; every refresh slides the window. */
export const SESSION_IDLE_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;

/** Not revoked and used within the idle limit. */
export function isSessionLive(session: Session, now: Date): boolean {
  return (
    session.revokedAt === null &&
    now.getTime() - session.lastUsedAt.getTime() < SESSION_IDLE_LIMIT_MS
  );
}

export interface CurrentSession {
  sessionId: string;
  user: User;
}

export interface GetCurrentSessionDependencies {
  accessTokens: AccessTokenIssuer;
  sessions: SessionRepository;
  users: UserRepository;
  clock: Clock;
}

/**
 * Authenticates an access token: a valid signature and expiry are not enough, the session row it
 * names must still be live (threat R-16) and its user must exist. The user id comes only from the
 * verified token, never from the request.
 */
export class GetCurrentSession {
  constructor(private readonly deps: GetCurrentSessionDependencies) {}

  async execute(accessToken: string | undefined): Promise<CurrentSession | null> {
    if (!accessToken) return null;
    const claims = await this.deps.accessTokens.verify(accessToken);
    if (!claims) return null;

    const session = await this.deps.sessions.findById(claims.sessionId);
    if (
      !session ||
      session.userId !== claims.userId ||
      !isSessionLive(session, this.deps.clock.now())
    ) {
      return null;
    }

    const user = await this.deps.users.findById(session.userId);
    return user ? { sessionId: session.id, user } : null;
  }
}
