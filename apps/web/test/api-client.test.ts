import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientWith(...responses: (Response | Error)[]) {
  const queue = [...responses];
  const fetch = vi.fn<FetchLike>(() => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch call');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { client: createApiClient({ baseUrl: BASE_URL, fetch }), fetch };
}

function requestAt(fetch: ReturnType<typeof clientWith>['fetch'], index: number) {
  const call = fetch.mock.calls[index];
  if (!call) throw new Error(`no fetch call #${index}`);
  const [url, init] = call;
  return { url, init: init ?? {} };
}

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends cookies, the CSRF header and a JSON body to the API origin', async () => {
    const { client, fetch } = clientWith(jsonResponse(202, { status: 'verification_sent' }));

    const result = await client.register({
      email: 'ana@example.com',
      password: 'correct horse battery',
      timeZone: 'America/Cordoba',
      language: 'es-AR',
    });

    expect(result).toEqual({ ok: true, data: { status: 'verification_sent' } });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/auth/register`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const headers = new Headers(init.headers);
    expect(headers.get('X-Requested-With')).toBe('argent');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'ana@example.com',
      password: 'correct horse battery',
      timeZone: 'America/Cordoba',
      language: 'es-AR',
    });
  });

  it.each([
    [400, 'PASSWORD_TOO_SHORT', 'passwordTooShort'],
    [400, 'PASSWORD_BREACHED', 'passwordBreached'],
    [400, 'TOKEN_INVALID', 'tokenInvalid'],
    [429, 'RATE_LIMITED', 'retryLater'],
    [503, 'PASSWORD_CHECK_UNAVAILABLE', 'retryLater'],
    [400, 'VALIDATION_FAILED', 'validationFailed'],
    [500, 'INTERNAL', 'unexpected'],
  ] as const)('maps %i %s to the message key %s', async (status, code, messageKey) => {
    const { client } = clientWith(jsonResponse(status, { code }));

    const result = await client.register({ email: 'ana@example.com', password: 'x' });

    expect(result).toEqual({ ok: false, code, messageKey });
  });

  it('maps wrong credentials to the generic message without trying to refresh', async () => {
    const { client, fetch } = clientWith(jsonResponse(401, { code: 'INVALID_CREDENTIALS' }));

    const result = await client.signIn({ email: 'ana@example.com', password: 'wrong password' });

    expect(result).toEqual({
      ok: false,
      code: 'INVALID_CREDENTIALS',
      messageKey: 'invalidCredentials',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a network failure with the generic retry message', async () => {
    const { client } = clientWith(new TypeError('Failed to fetch'));

    const result = await client.requestPasswordReset({ email: 'ana@example.com' });

    expect(result).toEqual({ ok: false, code: 'NETWORK', messageKey: 'network' });
  });

  it('treats a response that does not match the shared schema as unexpected', async () => {
    const { client } = clientWith(jsonResponse(200, { status: 'something else' }));

    const result = await client.verifyEmail({ token: 'a'.repeat(43) });

    expect(result).toEqual({ ok: false, code: 'INTERNAL', messageKey: 'unexpected' });
  });

  it('treats an error body that is not an API error as unexpected', async () => {
    const { client } = clientWith(new Response('<html>Bad gateway</html>', { status: 502 }));

    const result = await client.signIn({ email: 'ana@example.com', password: 'x' });

    expect(result).toEqual({ ok: false, code: 'INTERNAL', messageKey: 'unexpected' });
  });

  it('refreshes the session once on UNAUTHENTICATED and retries the request', async () => {
    const session = {
      user: {
        id: 'u1',
        email: 'ana@example.com',
        emailVerified: true,
        language: 'es',
        timeZone: 'America/Cordoba',
      },
    };
    const { client, fetch } = clientWith(
      jsonResponse(401, { code: 'UNAUTHENTICATED' }),
      // Inside the refresh lock the request is retried first: another tab may have refreshed.
      jsonResponse(401, { code: 'UNAUTHENTICATED' }),
      jsonResponse(200, { status: 'refreshed' }),
      jsonResponse(200, session),
    );

    const result = await client.getSession();

    expect(result).toEqual({ ok: true, data: session });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${BASE_URL}/auth/session`,
      `${BASE_URL}/auth/session`,
      `${BASE_URL}/auth/refresh`,
      `${BASE_URL}/auth/session`,
    ]);
    expect(requestAt(fetch, 0).init.method).toBe('GET');
    expect(requestAt(fetch, 2).init.method).toBe('POST');
  });

  it('shares one refresh between concurrent calls, so a rotated token is never reused', async () => {
    const session = {
      user: { id: 'u1', email: 'a@b.c', emailVerified: true, language: 'es', timeZone: 'UTC' },
    };
    let refreshes = 0;
    const fetch = vi.fn<FetchLike>((url: string): Promise<Response> => {
      if (url.endsWith('/auth/refresh')) {
        refreshes += 1;
        return Promise.resolve(jsonResponse(200, { status: 'refreshed' }));
      }
      return Promise.resolve(
        refreshes > 0 ? jsonResponse(200, session) : jsonResponse(401, { code: 'UNAUTHENTICATED' }),
      );
    });
    const client = createApiClient({ baseUrl: BASE_URL, fetch });

    const results = await Promise.all([client.getSession(), client.getSession()]);

    expect(results).toEqual([
      { ok: true, data: session },
      { ok: true, data: session },
    ]);
    expect(refreshes).toBe(1);
  });

  it('gives up with UNAUTHENTICATED when the refresh is refused', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(401, { code: 'UNAUTHENTICATED' }),
      jsonResponse(401, { code: 'UNAUTHENTICATED' }),
      jsonResponse(401, { code: 'UNAUTHENTICATED' }),
    );

    const result = await client.resendVerification();

    expect(result).toEqual({ ok: false, code: 'UNAUTHENTICATED', messageKey: 'unauthenticated' });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${BASE_URL}/auth/verification/resend`,
      `${BASE_URL}/auth/verification/resend`,
      `${BASE_URL}/auth/refresh`,
    ]);
  });

  it('signs out with an empty body and accepts the 204 answer', async () => {
    const { client, fetch } = clientWith(new Response(null, { status: 204 }));

    const result = await client.signOut();

    expect(result).toEqual({ ok: true, data: undefined });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/auth/sign-out`);
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('refreshes under the cross-tab lock and skips the refresh when another tab already did', async () => {
    const session = {
      user: { id: 'u1', email: 'a@b.c', emailVerified: true, language: 'es', timeZone: 'UTC' },
    };
    const lockNames: string[] = [];
    const locks = {
      request: (name: string, callback: () => Promise<unknown>) => {
        lockNames.push(name);
        return callback();
      },
    };
    vi.stubGlobal('navigator', { locks });
    const { client, fetch } = clientWith(
      jsonResponse(401, { code: 'UNAUTHENTICATED' }),
      // By the time this tab holds the lock, the other tab's refresh has set new cookies.
      jsonResponse(200, session),
    );

    const result = await client.getSession();

    expect(result).toEqual({ ok: true, data: session });
    expect(lockNames).toEqual(['argent-refresh']);
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain(`${BASE_URL}/auth/refresh`);
  });

  it('serializes refreshes inside the tab when the Web Locks API is missing', async () => {
    vi.stubGlobal('navigator', {});
    const session = {
      user: { id: 'u1', email: 'a@b.c', emailVerified: true, language: 'es', timeZone: 'UTC' },
    };
    let refreshes = 0;
    const fetch = vi.fn<FetchLike>((url: string): Promise<Response> => {
      if (url.endsWith('/auth/refresh')) {
        refreshes += 1;
        return Promise.resolve(jsonResponse(200, { status: 'refreshed' }));
      }
      return Promise.resolve(
        refreshes > 0 ? jsonResponse(200, session) : jsonResponse(401, { code: 'UNAUTHENTICATED' }),
      );
    });
    const client = createApiClient({ baseUrl: BASE_URL, fetch });

    const results = await Promise.all([
      client.getSession(),
      client.getSession(),
      client.getSession(),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(refreshes).toBe(1);
  });

  it('reports NETWORK, not the 401, when the refresh itself cannot reach the API', async () => {
    const { client } = clientWith(
      jsonResponse(401, { code: 'UNAUTHENTICATED' }),
      jsonResponse(401, { code: 'UNAUTHENTICATED' }),
      new TypeError('Failed to fetch'),
    );

    const result = await client.getSession();

    expect(result).toEqual({ ok: false, code: 'NETWORK', messageKey: 'network' });
  });

  it('never follows redirects', async () => {
    const { client, fetch } = clientWith(jsonResponse(202, { status: 'verification_sent' }));

    await client.register({ email: 'ana@example.com', password: 'correct horse battery' });

    expect(requestAt(fetch, 0).init.redirect).toBe('error');
  });

  it('maps a 3xx answer to NETWORK', async () => {
    const { client } = clientWith(
      new Response(null, { status: 302, headers: { Location: 'https://elsewhere.test/' } }),
    );

    const result = await client.signIn({ email: 'ana@example.com', password: 'x' });

    expect(result).toEqual({ ok: false, code: 'NETWORK', messageKey: 'network' });
  });

  describe('against a real HTTP server', () => {
    let server: Server | undefined;

    afterEach(async () => {
      await new Promise((resolve) => server?.close(resolve));
    });

    it('maps a redirect from the API origin to NETWORK', async () => {
      let followed = false;
      server = createServer((req, res) => {
        if (req.url === '/elsewhere') followed = true;
        res.writeHead(302, { Location: '/elsewhere' }).end();
      });
      await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      const client = createApiClient({ baseUrl: `http://127.0.0.1:${port}` });

      const result = await client.getSession();

      expect(result).toEqual({ ok: false, code: 'NETWORK', messageKey: 'network' });
      expect(followed).toBe(false);
    });
  });
});

describe('api client: two-factor authentication', () => {
  const RECOVERY_CODES = Array.from({ length: 10 }, (_, index) => `ABCDE-FGH${index}J`);
  const SIGNED_IN = {
    status: 'signed_in',
    user: { id: 'u1', email: 'ana@example.com', emailVerified: true, language: 'es' },
  };

  it.each([
    [400, 'TOTP_INVALID', 'codeInvalid'],
    [401, 'SECOND_FACTOR_INVALID', 'codeInvalid'],
    [401, 'SECOND_FACTOR_EXPIRED', 'secondFactorExpired'],
    [409, 'TWO_FACTOR_ALREADY_ENABLED', 'twoFactorAlreadyEnabled'],
    [409, 'TWO_FACTOR_NOT_ENABLED', 'twoFactorNotEnabled'],
    [409, 'TWO_FACTOR_SETUP_REQUIRED', 'twoFactorSetupRequired'],
    [503, 'TWO_FACTOR_UNAVAILABLE', 'retryLater'],
    [429, 'RATE_LIMITED', 'retryLater'],
  ] as const)('maps %i %s to the message key %s', async (status, code, messageKey) => {
    const { client } = clientWith(jsonResponse(status, { code }));

    const result = await client.disableTwoFactor({ code: '123456' });

    expect(result).toEqual({ ok: false, code, messageKey });
  });

  it('reads the status, starts a setup, enables and disables with the session cookies', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, { enabled: false, recoveryCodesRemaining: 0 }),
      jsonResponse(200, { otpauthUri: 'otpauth://totp/Pesly:ana', secret: 'JBSWY3DPEHPK3PXP' }),
      jsonResponse(200, { recoveryCodes: RECOVERY_CODES }),
      new Response(null, { status: 204 }),
    );

    expect(await client.getTwoFactorStatus()).toEqual({
      ok: true,
      data: { enabled: false, recoveryCodesRemaining: 0 },
    });
    expect(await client.startTwoFactorSetup()).toEqual({
      ok: true,
      data: { otpauthUri: 'otpauth://totp/Pesly:ana', secret: 'JBSWY3DPEHPK3PXP' },
    });
    expect(await client.enableTwoFactor({ code: '123456' })).toEqual({
      ok: true,
      data: { recoveryCodes: RECOVERY_CODES },
    });
    expect(await client.disableTwoFactor({ code: 'abcde-fghij' })).toEqual({
      ok: true,
      data: undefined,
    });

    const sent = fetch.mock.calls.map(([url, init]) => ({
      url,
      method: init?.method,
      credentials: init?.credentials,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    }));
    expect(sent).toEqual([
      { url: `${BASE_URL}/auth/2fa`, method: 'GET', credentials: 'include', body: undefined },
      { url: `${BASE_URL}/auth/2fa/setup`, method: 'POST', credentials: 'include', body: {} },
      {
        url: `${BASE_URL}/auth/2fa/enable`,
        method: 'POST',
        credentials: 'include',
        body: { code: '123456' },
      },
      {
        url: `${BASE_URL}/auth/2fa/disable`,
        method: 'POST',
        credentials: 'include',
        body: { code: 'abcde-fghij' },
      },
    ]);
  });

  type Client = ReturnType<typeof clientWith>['client'];
  const SETTINGS_CALLS: [string, string, (client: Client) => Promise<unknown>][] = [
    ['getTwoFactorStatus', '/auth/2fa', (client) => client.getTwoFactorStatus()],
    ['startTwoFactorSetup', '/auth/2fa/setup', (client) => client.startTwoFactorSetup()],
    ['enableTwoFactor', '/auth/2fa/enable', (client) => client.enableTwoFactor({ code: '123456' })],
    [
      'disableTwoFactor',
      '/auth/2fa/disable',
      (client) => client.disableTwoFactor({ code: '123456' }),
    ],
    ['getProfile', '/profile', (client) => client.getProfile()],
    ['updateProfile', '/profile', (client) => client.updateProfile({ displayName: 'Ana' })],
  ];

  it.each(SETTINGS_CALLS)(
    '%s refreshes the session once when the access token is refused',
    async (_name, path, call) => {
      const { client, fetch } = clientWith(
        jsonResponse(401, { code: 'UNAUTHENTICATED' }),
        jsonResponse(401, { code: 'UNAUTHENTICATED' }),
        jsonResponse(401, { code: 'UNAUTHENTICATED' }),
      );

      const result = await call(client);

      expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        `${BASE_URL}${path}`,
        `${BASE_URL}${path}`,
        `${BASE_URL}/auth/refresh`,
      ]);
    },
  );

  const PROFILE = {
    displayName: null,
    email: 'ana@example.com',
    twoFactorEnabled: false,
    preferences: {
      defaultRateType: 'blue',
      displayCurrency: 'ARS',
      timeZone: 'America/Argentina/Buenos_Aires',
      language: 'es',
    },
  };

  it('reads the profile with the session cookies and the CSRF header (FR-02)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, PROFILE));

    const result = await client.getProfile();

    expect(result).toEqual({ ok: true, data: PROFILE });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/profile`);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('X-Requested-With')).toBe('argent');
    expect(init.body).toBeUndefined();
  });

  it('updates the profile with PATCH, a JSON body, the cookies and the CSRF header (FR-02)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, { ...PROFILE, displayName: 'Ana' }));

    const result = await client.updateProfile({ displayName: 'Ana' });

    expect(result).toEqual({ ok: true, data: { ...PROFILE, displayName: 'Ana' } });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/profile`);
    expect(init.method).toBe('PATCH');
    expect(init.credentials).toBe('include');
    const headers = new Headers(init.headers);
    expect(headers.get('X-Requested-With')).toBe('argent');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ displayName: 'Ana' });
  });

  it.each([
    ['getProfile', (client: Client) => client.getProfile()],
    ['updateProfile', (client: Client) => client.updateProfile({ displayName: 'Ana' })],
  ] as const)('maps a %s body that does not parse to INTERNAL (sad path)', async (_name, call) => {
    const { client } = clientWith(jsonResponse(200, { ...PROFILE, email: undefined }));

    const result = await call(client);

    expect(result).toEqual({ ok: false, code: 'INTERNAL', messageKey: 'unexpected' });
  });

  it('maps a 400 on the profile update to the generic validation message (sad path)', async () => {
    const { client } = clientWith(
      jsonResponse(400, { code: 'VALIDATION_FAILED', fields: ['displayName'] }),
    );

    const result = await client.updateProfile({ displayName: 'Ana' });

    expect(result).toEqual({
      ok: false,
      code: 'VALIDATION_FAILED',
      messageKey: 'validationFailed',
    });
  });

  it('verifies the second factor with the challenge cookie and returns the signed-in user', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, SIGNED_IN));

    const result = await client.verifySecondFactor({ code: '123456' });

    expect(result).toEqual({ ok: true, data: SIGNED_IN });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/auth/2fa/verify`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ code: '123456' });
  });

  it('never refreshes a session for the second step: there is none yet (sad path)', async () => {
    const { client, fetch } = clientWith(jsonResponse(401, { code: 'UNAUTHENTICATED' }));

    const result = await client.verifySecondFactor({ code: '123456' });

    expect(result).toEqual({ ok: false, code: 'UNAUTHENTICATED', messageKey: 'unauthenticated' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
