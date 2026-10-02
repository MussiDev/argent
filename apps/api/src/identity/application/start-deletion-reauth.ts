import { GoogleReauthenticationNotAllowed, RateLimited, Unauthenticated } from '../domain/errors';
import { UNKNOWN_IP } from './client-ip';
import type { AttemptLimiter } from './ports/attempt-limiter';
import type { Clock } from './ports/clock';
import type { GoogleIdentityProvider } from './ports/google-identity-provider';
import type { OAuthStateRepository } from './ports/oauth-state-repository';
import type { SessionRepository } from './ports/session-repository';
import type { TokenGenerator } from './ports/token-generator';
import type { UserRepository } from './ports/user-repository';
import { GOOGLE_START_IP_POLICY, OAUTH_STATE_TTL_MS } from './start-google-sign-in';

export interface StartDeletionReauthDependencies {
  attemptLimiter: AttemptLimiter;
  users: UserRepository;
  sessions: SessionRepository;
  oauthStates: OAuthStateRepository;
  google: GoogleIdentityProvider;
  tokenGenerator: TokenGenerator;
  clock: Clock;
}

export interface StartDeletionReauthInput {
  userId: string;
  /** The session that asks; the state is bound to its family, which survives token rotation. */
  sessionId: string;
  ip: string | undefined;
}

export interface StartDeletionReauthResult {
  authorizationUrl: string;
  /** For the binding cookie, which ties the callback to this browser. */
  binding: string;
}

/**
 * Sends a user without a password to Google to prove they are present before deleting the
 * account (FR-04). Reuses the sign-in start's state, binding, nonce and PKCE protections; the
 * stored state says it is for deleting this user's account, so it can never sign anyone in.
 */
export class StartDeletionReauth {
  constructor(private readonly deps: StartDeletionReauthDependencies) {}

  async execute({
    userId,
    sessionId,
    ip,
  }: StartDeletionReauthInput): Promise<StartDeletionReauthResult> {
    const attempt = await this.deps.attemptLimiter.record(GOOGLE_START_IP_POLICY, ip ?? UNKNOWN_IP);
    if (!attempt.allowed) throw new RateLimited();

    const user = await this.deps.users.findById(userId);
    const session = await this.deps.sessions.findById(sessionId);
    if (!user || !session) throw new Unauthenticated();
    // Accounts with a password delete with it; Google never replaces it.
    if (user.passwordHash !== null) throw new GoogleReauthenticationNotAllowed();

    const tokens = this.deps.tokenGenerator;
    const state = tokens.generate();
    const binding = tokens.generate();
    const nonce = tokens.generate();
    const codeVerifier = tokens.generate();
    // Built before the state is stored, so an unconfigured provider leaves no row behind.
    const authorizationUrl = this.deps.google.authorizationUrl({
      state,
      nonce,
      codeVerifier,
      reauthenticate: true,
    });

    const now = this.deps.clock.now();
    await this.deps.oauthStates.create({
      stateHash: tokens.hash(state),
      bindingHash: tokens.hash(binding),
      nonceHash: tokens.hash(nonce),
      codeVerifier,
      timeZone: user.timeZone,
      language: user.language,
      purpose: 'delete_account',
      userId: user.id,
      sessionFamilyId: session.familyId,
      expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
    });
    return { authorizationUrl, binding };
  }
}
