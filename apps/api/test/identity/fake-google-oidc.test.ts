import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  fakeGoogleLoginHint,
  pkceChallenge,
  startFakeGoogleOidc,
  type FakeGoogleIdentity,
  type FakeGoogleOidc,
} from '../fixtures/fake-google-oidc';

const REGISTERED_REDIRECT_URI = 'http://localhost:4000/auth/google/callback';
const IDENTITY: FakeGoogleIdentity = {
  sub: '110169484474386276334',
  email: 'ana@gmail.com',
  emailVerified: true,
};

let google: FakeGoogleOidc;

beforeAll(async () => {
  google = await startFakeGoogleOidc();
});

afterAll(async () => {
  await google.close();
});

function authorizeUrl(
  origin: string,
  overrides: Record<string, string> = {},
  clientId = google.clientId,
): URL {
  const url = new URL(`${origin}/authorize`);
  const params = {
    client_id: clientId,
    redirect_uri: REGISTERED_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email',
    state: 'the-state',
    nonce: 'the-nonce',
    code_challenge: 'the-challenge',
    code_challenge_method: 'S256',
    ...overrides,
  };
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url;
}

function hiddenInputs(html: string): [string, string][] {
  return [...html.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)">/g)].map(
    (match) => [match[1] ?? '', match[2] ?? ''],
  );
}

describe('fake Google /authorize', () => {
  it('registers http://localhost:4000/auth/google/callback by default', () => {
    expect(google.redirectUris).toEqual([REGISTERED_REDIRECT_URI]);
  });

  it('rejects a redirect_uri that is not registered, like Google', async () => {
    const response = await fetch(
      authorizeUrl(google.origin, {
        redirect_uri: 'http://localhost:4000/auth/google/elsewhere',
        login_hint: fakeGoogleLoginHint(IDENTITY),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('redirect_uri_mismatch');
  });

  it.each(['email', 'profile email', ''])('rejects a scope without openid (%j)', async (scope) => {
    const response = await fetch(
      authorizeUrl(google.origin, { scope, login_hint: fakeGoogleLoginHint(IDENTITY) }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('invalid_scope');
  });

  it('accepts openid anywhere in the scope list', async () => {
    const { continueUrl } = await google.consent(
      authorizeUrl(google.origin, { scope: 'email openid' }).href,
      IDENTITY,
    );

    expect(new URL(continueUrl).searchParams.get('code')).toBeTruthy();
  });

  it('accepts only the redirect URIs it was started with', async () => {
    const registered = 'http://localhost:4500/auth/google/callback';
    const other = await startFakeGoogleOidc({ redirectUris: [registered] });
    try {
      const { continueUrl } = await other.consent(
        authorizeUrl(other.origin, { redirect_uri: registered }, other.clientId).href,
        IDENTITY,
      );
      expect(continueUrl.startsWith(`${registered}?`)).toBe(true);

      const response = await fetch(
        authorizeUrl(other.origin, { login_hint: fakeGoogleLoginHint(IDENTITY) }, other.clientId),
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('redirect_uri_mismatch');
    } finally {
      await other.close();
    }
  });

  it('without login_hint, shows a form that carries every parameter and leads to the consent page', async () => {
    const url = authorizeUrl(google.origin);
    const formPage = await fetch(url);
    const html = await formPage.text();

    expect(formPage.status).toBe(200);
    expect(html).toContain('<form method="get" action="/authorize">');
    expect(html).toContain('<input name="login_hint" required>');
    expect(Object.fromEntries(hiddenInputs(html))).toEqual(Object.fromEntries(url.searchParams));

    const submitted = new URL('/authorize', google.origin);
    for (const [name, value] of hiddenInputs(html)) submitted.searchParams.set(name, value);
    submitted.searchParams.set('login_hint', fakeGoogleLoginHint(IDENTITY));
    const consentPage = await (await fetch(submitted)).text();

    const continueHref = /id="continue" href="([^"]+)"/.exec(consentPage)?.[1] ?? '';
    const approved = new URL(continueHref.replaceAll('&amp;', '&'));
    expect(`${approved.origin}${approved.pathname}`).toBe(REGISTERED_REDIRECT_URI);
    expect(approved.searchParams.get('state')).toBe('the-state');
    expect(approved.searchParams.get('code')).toBeTruthy();
    expect(consentPage).toContain('id="cancel"');
  });
});

describe('fake Google name claim and profile scope (FR-04)', () => {
  const VERIFIER = 'the-verifier';

  async function tokenFor(
    identity: FakeGoogleIdentity,
    scope: string,
  ): Promise<{ scope: string; claims: Record<string, unknown>; approveScope: string }> {
    const { continueUrl } = await google.consent(
      authorizeUrl(google.origin, { scope, code_challenge: pkceChallenge(VERIFIER) }).href,
      identity,
    );
    const approved = new URL(continueUrl);
    const response = await fetch(google.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: approved.searchParams.get('code') ?? '',
        code_verifier: VERIFIER,
        redirect_uri: REGISTERED_REDIRECT_URI,
        client_id: google.clientId,
        client_secret: google.clientSecret,
      }),
    });
    const body = (await response.json()) as { id_token: string; scope: string };
    const payload = body.id_token.split('.')[1] ?? '';
    return {
      scope: body.scope,
      claims: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >,
      approveScope: approved.searchParams.get('scope') ?? '',
    };
  }

  it('issues the name when the identity has one and the scope includes profile', async () => {
    const { claims } = await tokenFor({ ...IDENTITY, name: 'Ana Gómez' }, 'openid email profile');

    expect(claims.name).toBe('Ana Gómez');
  });

  it('issues an empty name as the empty string, as Google could', async () => {
    const { claims } = await tokenFor({ ...IDENTITY, name: '' }, 'openid email profile');

    expect(claims.name).toBe('');
  });

  it('issues no name without the profile scope, even when the identity has one', async () => {
    const { claims } = await tokenFor({ ...IDENTITY, name: 'Ana Gómez' }, 'openid email');

    expect(claims).not.toHaveProperty('name');
  });

  it('issues no name when the identity has none, even with the profile scope', async () => {
    const { claims } = await tokenFor(IDENTITY, 'openid email profile');

    expect(claims).not.toHaveProperty('name');
  });

  it('lists profile in the scope of the approve redirect and of the token response', async () => {
    const { scope, approveScope } = await tokenFor(IDENTITY, 'openid email profile');

    expect(approveScope.split(' ')).toContain('profile');
    expect(scope.split(' ')).toContain('https://www.googleapis.com/auth/userinfo.profile');
  });

  it('carries the name through the login hint, including an empty one', () => {
    const hint = (identity: FakeGoogleIdentity) =>
      new URLSearchParams(fakeGoogleLoginHint(identity)).get('name');

    expect(hint({ ...IDENTITY, name: 'Ana Gómez' })).toBe('Ana Gómez');
    expect(hint({ ...IDENTITY, name: '' })).toBe('');
    expect(hint(IDENTITY)).toBeNull();
  });
});

describe('fake Google re-authentication: recorded requests and auth_time (NFR-04)', () => {
  const VERIFIER = 'the-verifier';

  afterEach(() => {
    google.resetTokenOptions();
  });

  async function claimsFor(
    overrides: Record<string, string> = {},
    identity: FakeGoogleIdentity = IDENTITY,
  ): Promise<Record<string, unknown>> {
    const { continueUrl } = await google.consent(
      authorizeUrl(google.origin, { code_challenge: pkceChallenge(VERIFIER), ...overrides }).href,
      identity,
    );
    const response = await fetch(google.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: new URL(continueUrl).searchParams.get('code') ?? '',
        code_verifier: VERIFIER,
        redirect_uri: REGISTERED_REDIRECT_URI,
        client_id: google.clientId,
        client_secret: google.clientSecret,
      }),
    });
    const body = (await response.json()) as { id_token: string };
    const payload = body.id_token.split('.')[1] ?? '';
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  }

  it('records every request to /authorize with its prompt and max_age', async () => {
    const before = google.authorizationRequests.length;

    await google.consent(
      authorizeUrl(google.origin, { prompt: 'login', max_age: '0', state: 'recorded' }).href,
      IDENTITY,
    );

    const recorded = google.authorizationRequests.slice(before);
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.at(-1)).toMatchObject({ prompt: 'login', max_age: '0', state: 'recorded' });
  });

  it('issues auth_time, close to now, when max_age was requested', async () => {
    const before = Math.floor(Date.now() / 1000);

    const claims = await claimsFor({ max_age: '0' });

    expect(claims.auth_time).toBeGreaterThanOrEqual(before);
    expect(claims.auth_time).toBeLessThanOrEqual(before + 60);
  });

  it('issues no auth_time when max_age was not requested', async () => {
    expect(await claimsFor()).not.toHaveProperty('auth_time');
  });

  it('lets a test choose the auth_time, or omit it with null, whatever max_age says', async () => {
    google.setTokenOptions({ authTime: 1_700_000_000 });
    expect((await claimsFor({ max_age: '0' })).auth_time).toBe(1_700_000_000);
    expect((await claimsFor()).auth_time).toBe(1_700_000_000);

    google.setTokenOptions({ authTime: null });
    expect(await claimsFor({ max_age: '0' })).not.toHaveProperty('auth_time');
  });
});
