import type { Language } from '../../domain/account-defaults';

export const OAUTH_STATE_PURPOSES = ['sign_in', 'delete_account'] as const;
export type OAuthStatePurpose = (typeof OAUTH_STATE_PURPOSES)[number];

/**
 * One pending OAuth flow. Secrets are stored as `TokenGenerator.hash` values; only the PKCE
 * verifier is kept in plaintext, because it must be sent to the token endpoint.
 */

export interface OAuthState {
  stateHash: string;
  /** Hash of the value in the browser's binding cookie, so only that browser completes the flow. */
  bindingHash: string;
  nonceHash: string;
  codeVerifier: string;
  /** Resolved preferences for an account created by this flow. */
  timeZone: string;
  language: Language;
  /** `sign_in` resolves or creates an account; `delete_account` only proves the user is present. */
  purpose: OAuthStatePurpose;
  /** Set for `delete_account` only: the user who started the re-authentication. */
  userId: string | null;
  /** Set for `delete_account` only: the session family that started it. */
  sessionFamilyId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

/** Sign-in states omit the three purpose fields: `purpose` defaults to `sign_in`, the rest to null. */
export type NewOAuthState = Omit<
  OAuthState,
  'createdAt' | 'purpose' | 'userId' | 'sessionFamilyId'
> &
  Partial<Pick<OAuthState, 'purpose' | 'userId' | 'sessionFamilyId'>>;

export interface OAuthStateRepository {
  create(state: NewOAuthState): Promise<void>;
  /**
   * Deletes and returns the state if its binding matches and it has not expired at `now`. Atomic,
   * so a state is consumed at most once; anything else resolves null.
   */
  consume(stateHash: string, bindingHash: string, now: Date): Promise<OAuthState | null>;
}
