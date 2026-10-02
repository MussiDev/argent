import { DELETION_GRANT_TTL_MS } from './delete-user';
import type { Clock } from './ports/clock';
import type { DeletionGrantRepository } from './ports/deletion-grant-repository';
import type { GoogleClaims } from './ports/google-identity-provider';
import type { OAuthState } from './ports/oauth-state-repository';
import type { SessionRepository } from './ports/session-repository';
import type { TokenGenerator } from './ports/token-generator';
import type { UserIdentityRepository } from './ports/user-identity-repository';

/** Google's `auth_time` may differ this much from our clock and from the state's creation. */
export const AUTH_TIME_TOLERANCE_SECONDS = 60;

export type DeletionReauthRefusal =
  'state_not_bound' | 'another_identity' | 'auth_time_out_of_window' | 'session_family_revoked';

export type CompleteDeletionReauthResult =
  | { outcome: 'issued'; token: string; userId: string }
  | { outcome: 'refused'; reason: DeletionReauthRefusal };

export interface CompleteDeletionReauthDependencies {
  identities: UserIdentityRepository;
  sessions: SessionRepository;
  deletionGrants: DeletionGrantRepository;
  tokenGenerator: TokenGenerator;
  clock: Clock;
}

/**
 * The second half of a Google re-authentication for deleting an account: the verified Google
 * account must be the one linked to the user who started it, freshly signed in, from a session
 * that still lives; then a single-use grant is issued. It never resolves, links or creates an
 * account. Every refusal is one outcome, answered the same way; `reason` is for logs only.
 */
export class CompleteDeletionReauth {
  constructor(private readonly deps: CompleteDeletionReauthDependencies) {}

  async execute({
    pending,
    claims,
  }: {
    pending: OAuthState;
    claims: GoogleClaims;
  }): Promise<CompleteDeletionReauthResult> {
    const refuse = (reason: DeletionReauthRefusal) => ({ outcome: 'refused', reason }) as const;
    const { userId, sessionFamilyId } = pending;
    if (pending.purpose !== 'delete_account' || userId === null || sessionFamilyId === null) {
      return refuse('state_not_bound');
    }

    // The subject proves the identity: Google's `email_verified` and the address do not matter.
    const linked = await this.deps.identities.findUserByProviderSubject('google', claims.subject);
    if (linked?.id !== userId) return refuse('another_identity');

    // Without the claim the fresh prompt=login and the single-use state are what is left (O-1).
    if (claims.authTime !== null) {
      const tolerance = AUTH_TIME_TOLERANCE_SECONDS * 1000;
      const authenticatedAt = claims.authTime * 1000;
      const now = this.deps.clock.now();
      if (
        authenticatedAt < pending.createdAt.getTime() - tolerance ||
        authenticatedAt > now.getTime() + tolerance
      ) {
        return refuse('auth_time_out_of_window');
      }
    }

    const now = this.deps.clock.now();
    if (!(await this.deps.sessions.isFamilyLive(sessionFamilyId, now))) {
      return refuse('session_family_revoked');
    }

    const tokens = this.deps.tokenGenerator;
    const token = tokens.generate();
    await this.deps.deletionGrants.replace({
      tokenHash: tokens.hash(token),
      userId,
      sessionFamilyId,
      credentialsVersion: linked.credentialsVersion,
      expiresAt: new Date(now.getTime() + DELETION_GRANT_TTL_MS),
    });
    return { outcome: 'issued', token, userId };
  }
}
