import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GoogleSignInFailed,
  type GoogleIdentityProvider,
} from '../../src/identity/application/ports/google-identity-provider';
import { CryptoTokenGenerator } from '../../src/identity/infrastructure/security/crypto-token-generator';
import {
  GOOGLE_TOKEN_TIMEOUT_MS,
  GoogleOidcIdentityProvider,
  type GoogleOidcOptions,
} from '../../src/identity/infrastructure/security/google-oidc-identity-provider';
import { UnconfiguredGoogleIdentityProvider } from '../../src/identity/infrastructure/security/unconfigured-google-identity-provider';
import { GOOGLE_ENDPOINT_DEFAULTS } from '../../src/shared/config/env';
import {
  startFakeGoogleOidc,
  type FakeGoogleIdentity,
  type FakeGoogleOidc,
} from '../fixtures/fake-google-oidc';

const API_ORIGIN = 'http://localhost:4000';
const REDIRECT_URI = `${API_ORIGIN}/auth/google/callback`;
const tokens = new CryptoTokenGenerator();

const GMAIL_USER: FakeGoogleIdentity = {
  sub: '110169484474386276334',
  email: 'Ana.Gomez@Gmail.com',
  emailVerified: true,
};
const WORKSPACE_USER: FakeGoogleIdentity = {
  sub: '220169484474386276335',
  email: 'ana@empresa.com.ar',
  emailVerified: false,
  hd: 'empresa.com.ar',
};

let google: FakeGoogleOidc;

beforeAll(async () => {
  google = await startFakeGoogleOidc();
});

afterAll(async () => {
  await google.close();
});

beforeEach(() => {
  google.resetTokenOptions();
});

function provider(overrides: Partial<GoogleOidcOptions> = {}): GoogleOidcIdentityProvider {
  return new GoogleOidcIdentityProvider({
    clientId: google.clientId,
    clientSecret: google.clientSecret,
    apiOrigin: API_ORIGIN,
    authorizationUrl: google.authorizationUrl,
    tokenUrl: google.tokenUrl,
    jwksUrl: google.jwksUrl,
    issuer: google.issuer,
    tokenGenerator: tokens,
    ...overrides,
  });
}

/** Runs the browser half of the flow against the fake server and returns what the callback gets. */
async function approve(google_: GoogleIdentityProvider, identity: FakeGoogleIdentity) {
  const nonce = tokens.generate();
  const codeVerifier = tokens.generate();
  const url = google_.authorizationUrl({ state: tokens.generate(), nonce, codeVerifier });
  const { continueUrl } = await google.consent(url, identity);
  const code = new URL(continueUrl).searchParams.get('code') ?? '';
  return { code, codeVerifier, expectedNonceHash: tokens.hash(nonce) };
}

async function failureOf(promise: Promise<unknown>): Promise<GoogleSignInFailed> {
  const error: unknown = await promise.then(
    () => new Error('expected the exchange to fail'),
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(GoogleSignInFailed);
  return error as GoogleSignInFailed;
}

describe('GoogleOidcIdentityProvider.exchangeCode', () => {
  it('returns the subject, lower-cased email, emailVerified and a null hostedDomain for a gmail.com account (NFR-02)', async () => {
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);

    await expect(google_.exchangeCode(exchange)).resolves.toEqual({
      subject: GMAIL_USER.sub,
      email: 'ana.gomez@gmail.com',
      emailVerified: true,
      hostedDomain: null,
    });
  });

  it('returns the hd claim as hostedDomain and passes emailVerified through unchanged', async () => {
    const google_ = provider();

    await expect(google_.exchangeCode(await approve(google_, WORKSPACE_USER))).resolves.toEqual({
      subject: WORKSPACE_USER.sub,
      email: 'ana@empresa.com.ar',
      emailVerified: false,
      hostedDomain: 'empresa.com.ar',
    });
  });

  it('rejects an ID token signed with another key (NFR-02)', async () => {
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);
    google.setTokenOptions({ signWithForeignKey: true });

    expect((await failureOf(google_.exchangeCode(exchange))).reason).toBe('bad_signature');
  });

  it('rejects an ID token for another audience (NFR-02)', async () => {
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);
    google.setTokenOptions({ audience: 'another-client.apps.googleusercontent.com' });

    expect((await failureOf(google_.exchangeCode(exchange))).reason).toBe('wrong_audience');
  });

  it('rejects an ID token from another issuer (NFR-02)', async () => {
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);
    google.setTokenOptions({ issuer: 'https://accounts.evil.example' });

    expect((await failureOf(google_.exchangeCode(exchange))).reason).toBe('wrong_issuer');
  });

  it('rejects an array audience whose azp is another client (NFR-02)', async () => {
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);
    google.setTokenOptions({
      audience: [google.clientId, 'another-client'],
      azp: 'another-client',
    });

    expect((await failureOf(google_.exchangeCode(exchange))).reason).toBe('wrong_azp');
  });

  it('rejects an array audience without azp', async () => {
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);
    google.setTokenOptions({ audience: [google.clientId, 'another-client'], azp: null });

    expect((await failureOf(google_.exchangeCode(exchange))).reason).toBe('wrong_azp');
  });

  it('accepts an array audience whose azp is this client', async () => {
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);
    google.setTokenOptions({ audience: [google.clientId, 'another-client'] });

    await expect(google_.exchangeCode(exchange)).resolves.toMatchObject({
      subject: GMAIL_USER.sub,
    });
  });

  it('rejects an ID token expired beyond the 60 s clock tolerance (NFR-02)', async () => {
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);
    google.setTokenOptions({ expiresInSeconds: -120 });

    expect((await failureOf(google_.exchangeCode(exchange))).reason).toBe('expired');
  });

  it('tolerates 60 s of clock skew on exp', async () => {
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);
    google.setTokenOptions({ expiresInSeconds: -30 });

    await expect(google_.exchangeCode(exchange)).resolves.toMatchObject({
      subject: GMAIL_USER.sub,
    });
  });

  it('rejects a nonce that does not match the stored hash (NFR-02)', async () => {
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);
    google.setTokenOptions({ nonce: 'a-nonce-from-another-flow' });

    expect((await failureOf(google_.exchangeCode(exchange))).reason).toBe('nonce_mismatch');
  });

  it('rejects when the stored nonce hash belongs to another nonce', async () => {
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);

    const failure = await failureOf(
      google_.exchangeCode({ ...exchange, expectedNonceHash: tokens.hash('other') }),
    );
    expect(failure.reason).toBe('nonce_mismatch');
  });

  it('rejects a wrong PKCE verifier (token endpoint 400)', async () => {
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);

    const failure = await failureOf(
      google_.exchangeCode({ ...exchange, codeVerifier: tokens.generate() }),
    );
    expect(failure.reason).toBe('token_http_status');
    expect(failure.status).toBe(400);
  });

  it('rejects wrong client credentials (token endpoint 401)', async () => {
    const google_ = provider({ clientSecret: 'not-the-secret' });
    const exchange = await approve(google_, GMAIL_USER);

    const failure = await failureOf(google_.exchangeCode(exchange));
    expect(failure.reason).toBe('token_http_status');
    expect(failure.status).toBe(401);
  });

  it('rejects a token endpoint slower than 2 s', async () => {
    expect(GOOGLE_TOKEN_TIMEOUT_MS).toBe(2000);
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);
    google.setTokenOptions({ delayMs: GOOGLE_TOKEN_TIMEOUT_MS + 1000 });

    const startedAt = performance.now();
    const failure = await failureOf(google_.exchangeCode(exchange));
    const elapsed = performance.now() - startedAt;

    expect(failure.reason).toBe('token_timeout');
    expect(elapsed).toBeGreaterThanOrEqual(GOOGLE_TOKEN_TIMEOUT_MS - 50);
    expect(elapsed).toBeLessThan(GOOGLE_TOKEN_TIMEOUT_MS + 800);
  }, 10_000);

  it('rejects a token endpoint error status', async () => {
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);
    google.setTokenOptions({ failWithStatus: 503 });

    const failure = await failureOf(google_.exchangeCode(exchange));
    expect(failure.reason).toBe('token_http_status');
    expect(failure.status).toBe(503);
  });

  it.each([
    ['malformed JSON', '{"id_token":'],
    ['a missing id_token', '{"access_token":"ya29.x"}'],
    ['an id_token over 4096 characters', JSON.stringify({ id_token: 'a'.repeat(4097) })],
  ])('rejects a token response with %s', async (_case, rawTokenBody) => {
    const google_ = provider();
    const exchange = await approve(google_, GMAIL_USER);
    google.setTokenOptions({ rawTokenBody });

    expect((await failureOf(google_.exchangeCode(exchange))).reason).toBe(
      'token_response_malformed',
    );
  });

  it('rejects a token endpoint that cannot be reached', async () => {
    const google_ = provider({ tokenUrl: 'http://127.0.0.1:1/token' });
    const exchange = await approve(google_, GMAIL_USER);

    expect((await failureOf(google_.exchangeCode(exchange))).reason).toBe('token_network');
  });

  it('rejects when the JWKS cannot be fetched', async () => {
    const google_ = provider({ jwksUrl: `${google.origin}/missing-jwks` });
    const exchange = await approve(google_, GMAIL_USER);

    expect((await failureOf(google_.exchangeCode(exchange))).reason).toBe('jwks_unavailable');
  });

  it.each(['email', 'email_verified', 'nonce', 'sub'])(
    'rejects an ID token without %s',
    async (claim) => {
      const google_ = provider();
      const exchange = await approve(google_, GMAIL_USER);
      google.setTokenOptions({ omitClaims: [claim] });

      expect((await failureOf(google_.exchangeCode(exchange))).reason).toBe('claims_malformed');
    },
  );

  it('rejects an ID token whose email is not a valid address', async () => {
    const google_ = provider();
    const exchange = await approve(google_, { ...GMAIL_USER, email: 'not-an-email' });

    expect((await failureOf(google_.exchangeCode(exchange))).reason).toBe('claims_malformed');
  });

  it("accepts both of Google's issuer spellings when configured with Google's issuer", async () => {
    for (const issuer of ['https://accounts.google.com', 'accounts.google.com']) {
      const google_ = provider({ issuer: GOOGLE_ENDPOINT_DEFAULTS.GOOGLE_ISSUER });
      const exchange = await approve(google_, GMAIL_USER);
      google.setTokenOptions({ issuer });

      await expect(google_.exchangeCode(exchange)).resolves.toMatchObject({
        subject: GMAIL_USER.sub,
      });
    }
  });

  it('posts the code, verifier, redirect URI and client credentials as a form, and never exposes them in the failure', async () => {
    const requests: { url: string; body: string }[] = [];
    const recordingFetch: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      requests.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
      return fetch(input, init);
    };
    const google_ = provider({ fetch: recordingFetch });
    const exchange = await approve(google_, GMAIL_USER);
    google.setTokenOptions({ signWithForeignKey: true });

    const failure = await failureOf(google_.exchangeCode(exchange));

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(google.tokenUrl);
    expect(Object.fromEntries(new URLSearchParams(requests[0]?.body))).toEqual({
      grant_type: 'authorization_code',
      code: exchange.code,
      code_verifier: exchange.codeVerifier,
      redirect_uri: REDIRECT_URI,
      client_id: google.clientId,
      client_secret: google.clientSecret,
    });
    const exposed = `${failure.message} ${JSON.stringify(failure)} ${String(failure.cause)}`;
    for (const secret of [exchange.code, exchange.codeVerifier, google.clientSecret]) {
      expect(exposed).not.toContain(secret);
    }
    expect(exposed).not.toContain('gmail');
  });
});

describe('GoogleOidcIdentityProvider.authorizationUrl', () => {
  it('carries state, nonce, the S256 challenge of the verifier, scope=openid email and the API callback', () => {
    const url = new URL(
      provider().authorizationUrl({
        state: 'the-state',
        nonce: 'the-nonce',
        codeVerifier: 'the-verifier',
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(google.authorizationUrl);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: google.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email',
      state: 'the-state',
      nonce: 'the-nonce',
      code_challenge: createHash('sha256').update('the-verifier').digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
  });

  it("points at Google's authorization endpoint when configured with it", () => {
    const url = new URL(
      provider({
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      }).authorizationUrl({ state: 's', nonce: 'n', codeVerifier: 'v' }),
    );

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.pathname).toBe('/o/oauth2/v2/auth');
  });
});

describe('UnconfiguredGoogleIdentityProvider', () => {
  it('fails every call with GoogleSignInFailed(not_configured)', async () => {
    const unconfigured: GoogleIdentityProvider = new UnconfiguredGoogleIdentityProvider();

    expect(() =>
      unconfigured.authorizationUrl({ state: 's', nonce: 'n', codeVerifier: 'v' }),
    ).toThrow(expect.objectContaining({ name: 'GoogleSignInFailed', reason: 'not_configured' }));
    expect(() =>
      unconfigured.authorizationUrl({ state: 's', nonce: 'n', codeVerifier: 'v' }),
    ).toThrow(GoogleSignInFailed);
    const failure = await failureOf(
      unconfigured.exchangeCode({ code: 'c', codeVerifier: 'v', expectedNonceHash: 'h' }),
    );
    expect(failure.reason).toBe('not_configured');
  });
});
