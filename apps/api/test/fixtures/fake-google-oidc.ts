import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';

/**
 * A local stand-in for Google's OpenID Connect provider, so no test ever calls Google.
 *
 * How to drive it:
 * - Integration tests (Block 3): `const google = await startFakeGoogleOidc()`, pass `google.env` to
 *   the API as its GOOGLE_* variables, take the `Location` of `GET /auth/google/start`, call
 *   `google.consent(location, identity)` and request `continueUrl` (or `cancelUrl`) against the
 *   API with the binding cookie. `google.setTokenOptions(...)` makes the next token responses
 *   misbehave (wrong audience, issuer, nonce, expiry, foreign key, algorithm, kid, future `iat`,
 *   delays, oversized body, `auth_time`); `resetTokenOptions()`
 *   restores them. `authorizationRequests` lists the queries `/authorize` received (a test reads
 *   `prompt` and `max_age` there); an authorization that asked for `max_age` gets an `auth_time`
 *   claim. `issueCode(...)` mints a code without the consent page (benchmarks that seed
 *   OAuth states directly).
 * - End-to-end tests (Block 4): Playwright starts `test/fake-google-oidc-server.ts` on 127.0.0.1.
 *   Google's redirect carries no `login_hint`, so the consent page first shows a form: fill the
 *   `login_hint` field with `fakeGoogleLoginHint(identity)`, submit, then click "Continue" (or
 *   "Cancel"). The click starts on 127.0.0.1, so the callback is a real cross-site navigation.
 */

export const FAKE_GOOGLE_CLIENT_ID = 'fake-google-client.apps.googleusercontent.com';
export const FAKE_GOOGLE_CLIENT_SECRET = 'fake-google-client-secret';
const KEY_ID = 'fake-google-key-1';
/** What the API's test environment (API_ORIGIN http://localhost:4000) sends as redirect_uri. */
const DEFAULT_REDIRECT_URI = 'http://localhost:4000/auth/google/callback';
const ID_TOKEN_TTL_SECONDS = 3600;
const CODE_TTL_MS = 5 * 60 * 1000;

export interface FakeGoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  /** Google Workspace domain; omitted for consumer accounts. */
  hd?: string;
  /** The `name` claim, issued only when the requested scope includes `profile`. */
  name?: string;
}

/** How the token endpoint misbehaves; every field left out behaves like Google. */
export interface FakeTokenOptions {
  /** Replaces `aud`; an array makes a multi-audience token. */
  audience?: string | string[];
  /** Replaces `azp`; null omits it. */
  azp?: string | null;
  issuer?: string;
  nonce?: string;
  /** `exp` relative to now; negative for an already expired token. */
  expiresInSeconds?: number;
  /** Signs with a key absent from `/jwks` but under the same `kid`. */
  signWithForeignKey?: boolean;
  /** HS256 signs with a random secret; `none` sends an unsigned token. */
  algorithm?: 'RS256' | 'HS256' | 'none';
  /** Replaces the `kid` header, e.g. with one absent from `/jwks`. */
  kid?: string;
  /** Shifts `iat` from now; positive for a token issued in the future. */
  issuedAtOffsetSeconds?: number;
  /** Claims removed from the ID token. */
  omitClaims?: string[];
  /** Waits this long before answering `/token`. */
  delayMs?: number;
  /** Answers `/token` with this status and `{ error: "server_error" }`. */
  failWithStatus?: number;
  /** Answers `/token` 200 with this body instead of a token response. */
  rawTokenBody?: string;
  /** Adds a `padding` field of this many characters to an otherwise valid token response. */
  tokenResponsePaddingBytes?: number;
  /** Claims set to these values after the identity's own, e.g. to make one malformed. */
  claimOverrides?: Record<string, unknown>;
  /** Waits this long before answering `/jwks`. */
  jwksDelayMs?: number;
  /**
   * The `auth_time` claim in seconds; null omits it. Left out, it is issued (as now) only for an
   * authorization that asked for `max_age`.
   */
  authTime?: number | null;
}

export interface FakeGoogleOidcOptions {
  host?: string;
  /** 0 picks a free port. */
  port?: number;
  clientId?: string;
  clientSecret?: string;
  /** Redirect URIs registered for the client; `/authorize` refuses any other, like Google. */
  redirectUris?: string[];
}

export interface IssueCodeInput {
  identity: FakeGoogleIdentity;
  nonce: string;
  /** base64url(SHA-256(verifier)). */
  codeChallenge: string;
  redirectUri: string;
  /** Scope the authorization requested; defaults to `openid email`. */
  scope?: string;
  /** The `max_age` the authorization asked for; Google then reports `auth_time` in the token. */
  maxAge?: string;
}

export interface FakeGoogleOidc {
  readonly origin: string;
  readonly issuer: string;
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
  readonly jwksUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUris: readonly string[];
  /** The GOOGLE_* environment variables pointing the API at this server. */
  readonly env: Record<string, string>;
  /** Token requests received, successful or not. */
  readonly tokenRequests: number;
  /** The query of every request to `/authorize`, in arrival order. */
  readonly authorizationRequests: readonly Readonly<Record<string, string>>[];
  setTokenOptions(options: FakeTokenOptions): void;
  resetTokenOptions(): void;
  issueCode(input: IssueCodeInput): string;
  /** Loads the consent page for `authorizationUrl` as `identity` and returns its two links. */
  consent(
    authorizationUrl: string,
    identity: FakeGoogleIdentity,
  ): Promise<{ continueUrl: string; cancelUrl: string }>;
  close(): Promise<void>;
}

/** Encodes an identity as the `login_hint` this server understands. */
export function fakeGoogleLoginHint(identity: FakeGoogleIdentity): string {
  const hint = new URLSearchParams({
    sub: identity.sub,
    email: identity.email,
    email_verified: String(identity.emailVerified),
  });
  if (identity.hd !== undefined) hint.set('hd', identity.hd);
  if (identity.name !== undefined) hint.set('name', identity.name);
  return hint.toString();
}

function parseLoginHint(raw: string): FakeGoogleIdentity | null {
  const hint = new URLSearchParams(raw);
  const sub = hint.get('sub');
  const email = hint.get('email');
  const verified = hint.get('email_verified');
  if (!sub || !email || (verified !== 'true' && verified !== 'false')) return null;
  const hd = hint.get('hd');
  const name = hint.get('name');
  return {
    sub,
    email,
    emailVerified: verified === 'true',
    ...(hd ? { hd } : {}),
    ...(name === null ? {} : { name }),
  };
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function unescapeHtml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function send(
  response: ServerResponse,
  status: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
) {
  response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  send(response, status, JSON.stringify(body), 'application/json');
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function requestedScopes(pending: PendingCode): string[] {
  return (pending.scope ?? 'openid email').split(' ');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PendingCode {
  identity: FakeGoogleIdentity;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
  scope?: string;
  maxAge?: string;
  expiresAt: number;
}

export async function startFakeGoogleOidc(
  options: FakeGoogleOidcOptions = {},
): Promise<FakeGoogleOidc> {
  const host = options.host ?? '127.0.0.1';
  const clientId = options.clientId ?? FAKE_GOOGLE_CLIENT_ID;
  const clientSecret = options.clientSecret ?? FAKE_GOOGLE_CLIENT_SECRET;
  const redirectUris = [...(options.redirectUris ?? [DEFAULT_REDIRECT_URI])];

  const signingKey = await generateKeyPair('RS256', { extractable: true });
  const foreignKey = await generateKeyPair('RS256');
  const publicJwk: JWK = {
    ...(await exportJWK(signingKey.publicKey)),
    kid: KEY_ID,
    alg: 'RS256',
    use: 'sig',
  };

  const codes = new Map<string, PendingCode>();
  let tokenOptions: FakeTokenOptions = {};
  let tokenRequests = 0;
  const authorizationRequests: Record<string, string>[] = [];
  let origin = '';

  function issueCode(input: IssueCodeInput): string {
    const code = `4/${randomBytes(24).toString('base64url')}`;
    codes.set(code, { ...input, expiresAt: Date.now() + CODE_TTL_MS });
    return code;
  }

  function authorize(url: URL, response: ServerResponse) {
    const params = url.searchParams;
    authorizationRequests.push(Object.fromEntries(params));
    const redirectUri = params.get('redirect_uri');
    const state = params.get('state');
    const nonce = params.get('nonce');
    const challenge = params.get('code_challenge');
    if (
      params.get('client_id') !== clientId ||
      params.get('response_type') !== 'code' ||
      params.get('code_challenge_method') !== 'S256' ||
      !redirectUri ||
      !URL.canParse(redirectUri) ||
      !state ||
      !nonce ||
      !challenge
    ) {
      send(response, 400, 'invalid_request');
      return;
    }
    if (!redirectUris.includes(redirectUri)) {
      send(response, 400, 'redirect_uri_mismatch');
      return;
    }
    if (!(params.get('scope') ?? '').split(' ').includes('openid')) {
      send(response, 400, 'invalid_scope');
      return;
    }

    const loginHint = params.get('login_hint');
    if (!loginHint) {
      const hidden = [...params.entries()]
        .map(
          ([name, value]) =>
            `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
        )
        .join('');
      send(
        response,
        200,
        `<!doctype html><title>Fake Google</title><form method="get" action="/authorize">${hidden}` +
          `<label>Identity <input name="login_hint" required></label>` +
          `<button type="submit">Sign in</button></form>`,
        'text/html; charset=utf-8',
      );
      return;
    }

    const identity = parseLoginHint(loginHint);
    if (!identity) {
      send(response, 400, 'invalid login_hint');
      return;
    }
    const code = issueCode({
      identity,
      nonce,
      codeChallenge: challenge,
      redirectUri,
      scope: params.get('scope') ?? undefined,
      maxAge: params.get('max_age') ?? undefined,
    });
    const approve = new URL(redirectUri);
    approve.searchParams.set('state', state);
    approve.searchParams.set('iss', origin);
    approve.searchParams.set('code', code);
    approve.searchParams.set(
      'scope',
      'email profile openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
    );
    approve.searchParams.set('authuser', '0');
    if (identity.hd) approve.searchParams.set('hd', identity.hd);
    approve.searchParams.set('prompt', 'consent');
    const cancel = new URL(redirectUri);
    cancel.searchParams.set('error', 'access_denied');
    cancel.searchParams.set('state', state);
    send(
      response,
      200,
      `<!doctype html><title>Fake Google</title><p>Continue as ${escapeHtml(identity.email)}?</p>` +
        `<a id="continue" href="${escapeHtml(approve.href)}">Continue</a> ` +
        `<a id="cancel" href="${escapeHtml(cancel.href)}">Cancel</a>`,
      'text/html; charset=utf-8',
    );
  }

  async function signIdToken(pending: PendingCode): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: tokenOptions.issuer ?? origin,
      aud: tokenOptions.audience ?? clientId,
      azp: tokenOptions.azp === undefined ? clientId : tokenOptions.azp,
      sub: pending.identity.sub,
      email: pending.identity.email,
      email_verified: pending.identity.emailVerified,
      nonce: tokenOptions.nonce ?? pending.nonce,
      iat: now + (tokenOptions.issuedAtOffsetSeconds ?? 0),
      exp: now + (tokenOptions.expiresInSeconds ?? ID_TOKEN_TTL_SECONDS),
      ...(pending.identity.hd ? { hd: pending.identity.hd } : {}),
      ...(tokenOptions.authTime === undefined
        ? pending.maxAge === undefined
          ? {}
          : { auth_time: now }
        : tokenOptions.authTime === null
          ? {}
          : { auth_time: tokenOptions.authTime }),
      ...(pending.identity.name !== undefined && requestedScopes(pending).includes('profile')
        ? { name: pending.identity.name }
        : {}),
      ...tokenOptions.claimOverrides,
    };
    const omitted = new Set(tokenOptions.omitClaims ?? []);
    if (claims.azp === null) omitted.add('azp');
    const payload = Object.fromEntries(
      Object.entries(claims).filter(([name]) => !omitted.has(name)),
    );
    const algorithm = tokenOptions.algorithm ?? 'RS256';
    const header = { alg: algorithm, kid: tokenOptions.kid ?? KEY_ID, typ: 'JWT' };
    if (algorithm === 'none') {
      const encode = (part: unknown) => Buffer.from(JSON.stringify(part)).toString('base64url');
      return `${encode(header)}.${encode(payload)}.`;
    }
    let key: CryptoKey | Uint8Array = signingKey.privateKey;
    if (algorithm === 'HS256') key = randomBytes(32);
    else if (tokenOptions.signWithForeignKey) key = foreignKey.privateKey;
    return new SignJWT(payload).setProtectedHeader(header).sign(key);
  }

  async function jwks(response: ServerResponse) {
    if (tokenOptions.jwksDelayMs) await delay(tokenOptions.jwksDelayMs);
    sendJson(response, 200, { keys: [publicJwk] });
  }

  async function token(request: IncomingMessage, response: ServerResponse) {
    tokenRequests += 1;
    const form = new URLSearchParams(await readBody(request));
    const current = tokenOptions;
    if (current.delayMs) await delay(current.delayMs);

    if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) {
      sendJson(response, 401, { error: 'invalid_client' });
      return;
    }
    const code = form.get('code') ?? '';
    const pending = codes.get(code);
    codes.delete(code);
    if (
      form.get('grant_type') !== 'authorization_code' ||
      !pending ||
      pending.expiresAt < Date.now() ||
      form.get('redirect_uri') !== pending.redirectUri ||
      pkceChallenge(form.get('code_verifier') ?? '') !== pending.codeChallenge
    ) {
      sendJson(response, 400, { error: 'invalid_grant', error_description: 'Bad Request' });
      return;
    }
    if (current.failWithStatus !== undefined) {
      sendJson(response, current.failWithStatus, { error: 'server_error' });
      return;
    }
    if (current.rawTokenBody !== undefined) {
      send(response, 200, current.rawTokenBody, 'application/json');
      return;
    }
    sendJson(response, 200, {
      access_token: `ya29.${randomBytes(16).toString('base64url')}`,
      expires_in: 3599,
      scope:
        'openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
      token_type: 'Bearer',
      id_token: await signIdToken(pending),
      ...(current.tokenResponsePaddingBytes === undefined
        ? {}
        : { padding: 'a'.repeat(current.tokenResponsePaddingBytes) }),
    });
  }

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', origin);
    if (request.method === 'GET' && url.pathname === '/authorize') {
      authorize(url, response);
    } else if (request.method === 'POST' && url.pathname === '/token') {
      token(request, response).catch((error: unknown) => {
        send(response, 500, error instanceof Error ? error.message : 'error');
      });
    } else if (request.method === 'GET' && url.pathname === '/jwks') {
      jwks(response).catch((error: unknown) => {
        send(response, 500, error instanceof Error ? error.message : 'error');
      });
    } else {
      send(response, 404, 'not found');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  origin = `http://${host}:${port}`;

  return {
    origin,
    issuer: origin,
    authorizationUrl: `${origin}/authorize`,
    tokenUrl: `${origin}/token`,
    jwksUrl: `${origin}/jwks`,
    clientId,
    clientSecret,
    redirectUris,
    env: {
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_CLIENT_SECRET: clientSecret,
      GOOGLE_AUTHORIZATION_URL: `${origin}/authorize`,
      GOOGLE_TOKEN_URL: `${origin}/token`,
      GOOGLE_JWKS_URL: `${origin}/jwks`,
      GOOGLE_ISSUER: origin,
    },
    get tokenRequests() {
      return tokenRequests;
    },
    get authorizationRequests() {
      return authorizationRequests;
    },
    setTokenOptions(next) {
      tokenOptions = { ...tokenOptions, ...next };
    },
    resetTokenOptions() {
      tokenOptions = {};
    },
    issueCode,
    async consent(authorizationUrl, identity) {
      const url = new URL(authorizationUrl);
      url.searchParams.set('login_hint', fakeGoogleLoginHint(identity));
      const response = await fetch(url);
      const html = await response.text();
      const link = (id: string) => {
        const match = new RegExp(`id="${id}" href="([^"]+)"`).exec(html);
        if (!match?.[1]) throw new Error(`fake Google consent page has no ${id} link: ${html}`);
        return unescapeHtml(match[1]);
      };
      return { continueUrl: link('continue'), cancelUrl: link('cancel') };
    },
    close() {
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
