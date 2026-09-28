import type { AccessTokenIssuer } from './ports/access-token-issuer';
import type { Clock } from './ports/clock';
import type { SessionRepository } from './ports/session-repository';
import type { TokenGenerator } from './ports/token-generator';
import type { User } from './ports/user-repository';

/** The secrets of a freshly started or rotated session; only ever sent to the client as cookies. */
export interface SessionTokens {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  /** Lifetime of the access token, in seconds. */
  accessTokenTtlSeconds: number;
}

export interface StartSessionDependencies {
  sessions: SessionRepository;
  tokenGenerator: TokenGenerator;
  accessTokens: AccessTokenIssuer;
  clock: Clock;
}

/** Opens a new session family for a user who just proved who they are (password or Google). */
export class StartSession {
  constructor(private readonly deps: StartSessionDependencies) {}

  /**
   * `credentialsVersion` must be the one read together with the credentials that were checked:
   * if a password change commits meanwhile, the session is created stale and rejected on first
   * use (AC-10).
   */
  async execute(user: Pick<User, 'id' | 'credentialsVersion'>): Promise<SessionTokens> {
    const refreshToken = this.deps.tokenGenerator.generate();
    const session = await this.deps.sessions.create({
      userId: user.id,
      refreshTokenHash: this.deps.tokenGenerator.hash(refreshToken),
      lastUsedAt: this.deps.clock.now(),
      credentialsVersion: user.credentialsVersion,
    });
    const accessToken = await this.deps.accessTokens.issue({
      userId: user.id,
      sessionId: session.id,
    });
    return {
      sessionId: session.id,
      accessToken,
      refreshToken,
      accessTokenTtlSeconds: this.deps.accessTokens.ttlSeconds,
    };
  }
}
