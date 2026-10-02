/** What a verified Google ID token says about the person; nothing here is a business decision. */
export interface GoogleClaims {
  /** Google's stable account identifier (`sub`). */
  subject: string;
  /** Lower-cased. */
  email: string;
  emailVerified: boolean;
  /** Google Workspace domain (`hd` claim), or null for consumer accounts. */
  hostedDomain: string | null;
  /** The `name` claim as Google sent it (untrusted free text), or null when absent or not text. */
  name: string | null;
  /**
   * When the person last authenticated at Google (`auth_time`, seconds since the epoch), or null
   * when the token does not carry a numeric one. Google sends it for requests with `max_age`.
   */
  authTime: number | null;
}

export interface GoogleAuthorizationRequest {
  state: string;
  nonce: string;
  /** Plain PKCE verifier; the adapter derives the S256 challenge sent to Google. */
  codeVerifier: string;
  /**
   * Ask Google to authenticate the person again (`prompt=login`, `max_age=0`) instead of offering
   * the account chooser; used to confirm a destructive action.
   */
  reauthenticate?: boolean;
}

export interface GoogleCodeExchange {
  code: string;
  codeVerifier: string;
  /** `TokenGenerator.hash` of the nonce sent with the authorization request. */
  expectedNonceHash: string;
}

export type GoogleSignInFailureReason =
  | 'not_configured'
  | 'token_timeout'
  | 'token_network'
  | 'token_http_status'
  | 'token_response_malformed'
  | 'jwks_unavailable'
  | 'no_matching_key'
  | 'bad_signature'
  | 'algorithm_not_allowed'
  | 'wrong_audience'
  | 'wrong_azp'
  | 'wrong_issuer'
  | 'expired'
  | 'invalid_token'
  | 'claims_malformed'
  | 'nonce_mismatch';

/**
 * Google sign-in could not produce verified claims. `reason` is for logs only; callers answer every
 * reason the same way. It never carries the code, the tokens or the verifier.
 */
export class GoogleSignInFailed extends Error {
  constructor(
    readonly reason: GoogleSignInFailureReason,
    readonly status?: number,
  ) {
    super(`Google sign-in failed: ${reason}${status === undefined ? '' : ` ${status}`}`);
    this.name = 'GoogleSignInFailed';
  }
}

/** Google OpenID Connect, authorization code flow with PKCE (confidential client). */
export interface GoogleIdentityProvider {
  /** Where to send the browser to ask Google for consent. */
  authorizationUrl(request: GoogleAuthorizationRequest): string;
  /**
   * Redeems the code and returns the claims of a fully verified ID token (signature, audience,
   * issuer, expiry and nonce). Rejects with `GoogleSignInFailed` otherwise.
   */
  exchangeCode(exchange: GoogleCodeExchange): Promise<GoogleClaims>;
}
