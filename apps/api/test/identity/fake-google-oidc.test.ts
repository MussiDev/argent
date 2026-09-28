import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fakeGoogleLoginHint,
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
