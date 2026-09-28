import { createHash, timingSafeEqual } from 'node:crypto';
import { emailInputSchema } from '@argent/shared';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';
import type { Clock } from '../../application/ports/clock';
import {
  GoogleSignInFailed,
  type GoogleAuthorizationRequest,
  type GoogleClaims,
  type GoogleCodeExchange,
  type GoogleIdentityProvider,
  type GoogleSignInFailureReason,
} from '../../application/ports/google-identity-provider';
import type { TokenGenerator } from '../../application/ports/token-generator';
import { Email } from '../../domain/email';

/** Bounds the whole token-endpoint exchange, body included (NFR-01). */
export const GOOGLE_TOKEN_TIMEOUT_MS = 2000;
const JWKS_TIMEOUT_MS = 2000;
export const GOOGLE_CALLBACK_PATH = '/auth/google/callback';
const ALGORITHM = 'RS256';
const CLOCK_TOLERANCE_SECONDS = 60;
/** Google ID tokens live one hour; bounding `iat` too refuses tokens dated in the future. */
const MAX_TOKEN_AGE = '1h';
/** Google signs with either spelling of its issuer (OpenID Connect discovery documents both). */
const GOOGLE_ISSUER = 'https://accounts.google.com';
const GOOGLE_ISSUERS = [GOOGLE_ISSUER, 'accounts.google.com'];

const tokenResponseSchema = z.object({ id_token: z.string().min(1).max(4096) });

const idTokenClaimsSchema = z.object({
  sub: z.string().min(1).max(255),
  email: emailInputSchema,
  email_verified: z.boolean(),
  nonce: z.string().min(1).max(128),
  hd: z.string().min(1).max(253).optional(),
  azp: z.string().optional(),
});

export interface GoogleOidcOptions {
  clientId: string;
  clientSecret: string;
  /** The redirect URI is this origin plus `/auth/google/callback`. */
  apiOrigin: string;
  authorizationUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  issuer: string;
  /** Hashes the returned nonce exactly as the stored `expectedNonceHash` was hashed. */
  tokenGenerator: Pick<TokenGenerator, 'hash'>;
  clock?: Clock;
  /** Injected in tests; defaults to the global fetch. Used for the token endpoint only. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Google OpenID Connect, authorization code flow with PKCE as a confidential client. Returns claims
 * only from an ID token whose RS256 signature, audience, issuer, expiry and nonce all check out
 * (NFR-02). Failures carry a reason, never the code, the tokens, the verifier or the claims: jose
 * errors embed the token payload, so they are not kept as `cause`.
 */
export class GoogleOidcIdentityProvider implements GoogleIdentityProvider {
  private readonly redirectUri: string;
  private readonly issuers: string[];
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  // Public signing keys only, refetched on an unknown `kid` (spec decision log: the one exception
  // to "no cache state in process memory").
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly options: GoogleOidcOptions) {
    this.redirectUri = `${new URL(options.apiOrigin).origin}${GOOGLE_CALLBACK_PATH}`;
    this.issuers = options.issuer === GOOGLE_ISSUER ? GOOGLE_ISSUERS : [options.issuer];
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? GOOGLE_TOKEN_TIMEOUT_MS;
    this.jwks = createRemoteJWKSet(new URL(options.jwksUrl), { timeoutDuration: JWKS_TIMEOUT_MS });
  }

  authorizationUrl({ state, nonce, codeVerifier }: GoogleAuthorizationRequest): string {
    const url = new URL(this.options.authorizationUrl);
    const params = {
      client_id: this.options.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email',
      state,
      nonce,
      code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    };
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    return url.href;
  }

  async exchangeCode({
    code,
    codeVerifier,
    expectedNonceHash,
  }: GoogleCodeExchange): Promise<GoogleClaims> {
    const idToken = await this.redeemCode(code, codeVerifier);
    const payload = await this.verify(idToken);

    const parsed = idTokenClaimsSchema.safeParse(payload);
    if (!parsed.success) throw new GoogleSignInFailed('claims_malformed');
    const claims = parsed.data;

    if (!this.sameHash(this.options.tokenGenerator.hash(claims.nonce), expectedNonceHash)) {
      throw new GoogleSignInFailed('nonce_mismatch');
    }

    let email: string;
    try {
      email = Email.parse(claims.email).value;
    } catch {
      // InvalidEmail: Google sent an address our accounts cannot hold.
      throw new GoogleSignInFailed('claims_malformed');
    }
    return {
      subject: claims.sub,
      email,
      emailVerified: claims.email_verified,
      hostedDomain: claims.hd ?? null,
    };
  }

  private async redeemCode(code: string, codeVerifier: string): Promise<string> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Raced as well as passed to fetch: the deadline holds even if a transport ignores the signal.
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const failure = new GoogleSignInFailed('token_timeout');
        controller.abort(failure);
        reject(failure);
      }, this.timeoutMs);
    });
    try {
      const body = await Promise.race([
        this.postTokenRequest(code, codeVerifier, controller.signal),
        deadline,
      ]);
      const parsed = tokenResponseSchema.safeParse(body);
      if (!parsed.success) throw new GoogleSignInFailed('token_response_malformed');
      return parsed.data.id_token;
    } catch (error) {
      if (error instanceof GoogleSignInFailed) throw error;
      throw new GoogleSignInFailed('token_network');
    } finally {
      clearTimeout(timer);
    }
  }

  private async postTokenRequest(
    code: string,
    codeVerifier: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const response = await this.fetchFn(this.options.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: this.redirectUri,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
      }).toString(),
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      // Release the connection instead of leaving an unread body to the garbage collector.
      await response.body?.cancel().catch(() => undefined);
      throw new GoogleSignInFailed('token_http_status', response.status);
    }
    try {
      return await response.json();
    } catch (error) {
      if (signal.aborted) throw error;
      throw new GoogleSignInFailed('token_response_malformed');
    }
  }

  private async verify(idToken: string): Promise<JWTPayload> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.jwks, {
        algorithms: [ALGORITHM],
        audience: this.options.clientId,
        issuer: this.issuers,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        maxTokenAge: MAX_TOKEN_AGE,
        requiredClaims: ['exp'],
        ...(this.options.clock ? { currentDate: this.options.clock.now() } : {}),
      }));
    } catch (error) {
      throw new GoogleSignInFailed(verificationFailure(error));
    }
    // With several audiences, `azp` names the client the token was issued to (OpenID Connect).
    if (Array.isArray(payload.aud) && payload.azp !== this.options.clientId) {
      throw new GoogleSignInFailed('wrong_azp');
    }
    return payload;
  }

  private sameHash(actual: string, expected: string): boolean {
    const a = Buffer.from(actual, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

function verificationFailure(error: unknown): GoogleSignInFailureReason {
  if (error instanceof errors.JWTExpired) return 'expired';
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === 'aud') return 'wrong_audience';
    if (error.claim === 'iss') return 'wrong_issuer';
    return 'invalid_token';
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) return 'bad_signature';
  if (error instanceof errors.JWKSNoMatchingKey) return 'no_matching_key';
  if (error instanceof errors.JOSEAlgNotAllowed) return 'algorithm_not_allowed';
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) {
    return 'jwks_unavailable';
  }
  // The JWKS fetch reports a bad status or body as a bare JOSEError, and a network fault as a
  // non-JOSE error; every JOSE subclass describes the token itself.
  if (error instanceof errors.JOSEError && error.code !== 'ERR_JOSE_GENERIC')
    return 'invalid_token';
  return 'jwks_unavailable';
}
