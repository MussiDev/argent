import type { Language } from '../../domain/account-defaults';

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
  createdAt: Date;
  expiresAt: Date;
}

export type NewOAuthState = Omit<OAuthState, 'createdAt'>;

export interface OAuthStateRepository {
  create(state: NewOAuthState): Promise<void>;
  /**
   * Deletes and returns the state if its binding matches and it has not expired at `now`. Atomic,
   * so a state is consumed at most once; anything else resolves null.
   */
  consume(stateHash: string, bindingHash: string, now: Date): Promise<OAuthState | null>;
}
