/** What a short-lived access token asserts: who the user is and which session it belongs to. */
export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

/**
 * Signs and verifies the stateless access token (a 15-minute JWT, NFR-05). Verification alone is
 * not enough to authenticate: the session row must also be live (threat R-16).
 */
export interface AccessTokenIssuer {
  /** Lifetime of issued tokens, in seconds. */
  readonly ttlSeconds: number;
  issue(claims: AccessTokenClaims): Promise<string>;
  /** Resolves null for a malformed, tampered, expired or otherwise unacceptable token. */
  verify(token: string): Promise<AccessTokenClaims | null>;
}
