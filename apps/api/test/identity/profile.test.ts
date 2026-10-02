import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import {
  createIdentityHarness,
  logEntries,
  type IdentityHarness,
} from '../helpers/identity-harness';
import {
  cookieHeader,
  seedUser,
  sessionFrom,
  signIn,
  signOut,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { seedTwoFactor } from '../helpers/two-factor-client';

let connection: DatabaseConnection;
let harness: IdentityHarness;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

beforeEach(() => {
  harness = createIdentityHarness(connection, { realSessions: true });
});

afterAll(async () => {
  await connection.pool.end();
});

const EMAIL = 'ana@example.com';
const PASSWORD = 'a long enough passphrase';

interface ProfileBody {
  displayName: string | null;
  email: string;
  twoFactorEnabled: boolean;
  deletionReauth: 'password' | 'google';
  preferences: {
    defaultRateType: string;
    displayCurrency: string;
    timeZone: string;
    language: string;
  };
}

async function login(email: string): Promise<SessionCookies> {
  const response = await signIn(harness.app, email, PASSWORD);
  expect(response.status).toBe(200);
  return sessionFrom(response);
}

async function signedIn(email = EMAIL): Promise<{ userId: string; cookies: SessionCookies }> {
  const userId = await seedUser(connection, { email, password: PASSWORD });
  return { userId, cookies: await login(email) };
}

function getProfile(cookies: Partial<SessionCookies>) {
  return request(harness.app).get('/profile').set('Cookie', cookieHeader(cookies));
}

function patchProfile(cookies: Partial<SessionCookies>, body: object) {
  return request(harness.app)
    .patch('/profile')
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(cookies))
    .send(body);
}

async function stored(userId: string) {
  const result = await connection.pool.query<{
    display_name: string | null;
    email: string;
    default_rate_type: string;
    display_currency: string;
    time_zone: string;
    language: string;
  }>(
    'select display_name, email, default_rate_type, display_currency, time_zone, language from users where id = $1',
    [userId],
  );
  return result.rows[0];
}

describe('GET /profile', () => {
  it('returns a null display name, the email and 2FA off for a fresh user', async () => {
    const { cookies } = await signedIn();

    const response = await getProfile(cookies);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      displayName: null,
      email: EMAIL,
      twoFactorEnabled: false,
      deletionReauth: 'password',
      preferences: {
        defaultRateType: 'mep',
        displayCurrency: 'ARS',
        timeZone: 'America/Cordoba',
        language: 'es',
      },
    });
  });

  it('reports deletionReauth google for a user without a password, also after an update', async () => {
    const { userId, cookies } = await signedIn();
    await connection.pool.query('update users set password_hash = null where id = $1', [userId]);

    const read = await getProfile(cookies);
    const updated = await patchProfile(cookies, { language: 'en' });

    expect((read.body as ProfileBody).deletionReauth).toBe('google');
    expect((updated.body as ProfileBody).deletionReauth).toBe('google');
  });

  it('shows twoFactorEnabled true once 2FA is enabled', async () => {
    const { userId, cookies } = await signedIn();
    await seedTwoFactor(connection, userId, harness.clock);

    const response = await getProfile(cookies);

    expect(response.status).toBe(200);
    expect((response.body as ProfileBody).twoFactorEnabled).toBe(true);
  });

  it('does not count a pending 2FA setup as enabled', async () => {
    const { cookies } = await signedIn();
    const setup = await request(harness.app)
      .post('/auth/2fa/setup')
      .set(trustedHeaders)
      .set('Cookie', cookieHeader(cookies))
      .send({});
    expect(setup.status).toBe(200);

    const response = await getProfile(cookies);

    expect(response.status).toBe(200);
    expect((response.body as ProfileBody).twoFactorEnabled).toBe(false);
  });

  it('answers 200 with a legacy time zone stored by registration', async () => {
    const { userId, cookies } = await signedIn();
    await connection.pool.query("update users set time_zone = '+01:00' where id = $1", [userId]);

    const response = await getProfile(cookies);

    expect(response.status).toBe(200);
    expect((response.body as ProfileBody).preferences.timeZone).toBe('+01:00');
  });

  it('answers 401 without a session (sad path)', async () => {
    const response = await getProfile({});

    expect(response.status).toBe(401);
    expect((response.body as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('answers 401 for a revoked session and for an expired access token (sad path)', async () => {
    const { cookies } = await signedIn();
    const revoked = await login(EMAIL);
    expect((await signOut(harness.app, revoked)).status).toBe(204);
    expect((await getProfile(revoked)).status).toBe(401);

    harness.clock.advance(20 * 60 * 1000);

    expect((await getProfile(cookies)).status).toBe(401);
  });

  it('answers 401 when the session user no longer exists (sad path)', async () => {
    const { userId, cookies } = await signedIn();
    await connection.pool.query('delete from users where id = $1', [userId]);

    expect((await getProfile(cookies)).status).toBe(401);
  });
});

describe('PATCH /profile', () => {
  it('persists a name of 1 to 50 characters and the next GET shows it', async () => {
    const { userId, cookies } = await signedIn();

    for (const name of ['A', '  Ana Pérez  ', 'x'.repeat(50)]) {
      const response = await patchProfile(cookies, { displayName: name });
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect((response.body as ProfileBody).displayName).toBe(name.trim());
      expect(((await getProfile(cookies)).body as ProfileBody).displayName).toBe(name.trim());
    }
    expect((await stored(userId))?.display_name).toBe('x'.repeat(50));
  });

  it('answers 400 for an empty, whitespace-only or 51-character name and keeps the previous one (sad path)', async () => {
    const { userId, cookies } = await signedIn();
    expect((await patchProfile(cookies, { displayName: 'Ana' })).status).toBe(200);

    for (const name of ['', '   ', 'x'.repeat(51)]) {
      const response = await patchProfile(cookies, { displayName: name });
      expect(response.status).toBe(400);
      expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
    }
    expect((await stored(userId))?.display_name).toBe('Ana');
  });

  it('rejects an email different from the account, accepts the same one in another case, and rejects an email-only body', async () => {
    const { userId, cookies } = await signedIn();

    const different = await patchProfile(cookies, {
      email: 'other@example.com',
      displayName: 'Ana',
    });
    expect(different.status).toBe(400);
    expect((different.body as { code: string }).code).toBe('VALIDATION_FAILED');
    expect(await stored(userId)).toMatchObject({ email: EMAIL, display_name: null });

    const same = await patchProfile(cookies, { email: 'ANA@Example.com', displayName: 'Ana' });
    expect(same.status).toBe(200);
    expect((same.body as ProfileBody).email).toBe(EMAIL);
    expect((await stored(userId))?.email).toBe(EMAIL);

    const onlyEmail = await patchProfile(cookies, { email: EMAIL });
    expect(onlyEmail.status).toBe(400);
  });

  it('returns a rate type and display currency to a new session after sign-out and sign-in', async () => {
    const { cookies } = await signedIn();
    const saved = await patchProfile(cookies, { defaultRateType: 'blue', displayCurrency: 'USD' });
    expect(saved.status).toBe(200);
    expect((await signOut(harness.app, cookies)).status).toBe(204);

    const next = await getProfile(await login(EMAIL));

    expect((next.body as ProfileBody).preferences).toMatchObject({
      defaultRateType: 'blue',
      displayCurrency: 'USD',
    });
  });

  it('persists Europe/Madrid, canonicalizing the case', async () => {
    const { userId, cookies } = await signedIn();

    const response = await patchProfile(cookies, { timeZone: 'europe/madrid' });

    expect(response.status).toBe(200);
    expect((response.body as ProfileBody).preferences.timeZone).toBe('Europe/Madrid');
    expect((await stored(userId))?.time_zone).toBe('Europe/Madrid');
  });

  it('answers 400 and writes nothing for a bad time zone, rate type, currency or language (sad path)', async () => {
    const { userId, cookies } = await signedIn();
    const before = await stored(userId);

    for (const body of [
      { timeZone: 'Mars/Olympus' },
      { timeZone: '+01:00' },
      { defaultRateType: 'nope' },
      { displayCurrency: 'EUR' },
      { language: 'fr' },
    ]) {
      const response = await patchProfile(cookies, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
    }
    expect(await stored(userId)).toEqual(before);
  });

  it('persists the language and writes nothing when a valid name comes with an invalid time zone', async () => {
    const { userId, cookies } = await signedIn();

    const saved = await patchProfile(cookies, { language: 'en' });
    expect(saved.status).toBe(200);
    expect((saved.body as ProfileBody).preferences.language).toBe('en');

    const mixed = await patchProfile(cookies, { displayName: 'Ana', timeZone: 'Mars/Olympus' });
    expect(mixed.status).toBe(400);
    expect(await stored(userId)).toMatchObject({ display_name: null, language: 'en' });
  });

  it('answers 400 for an empty body or only unknown keys (sad path)', async () => {
    const { cookies } = await signedIn();

    expect((await patchProfile(cookies, {})).status).toBe(400);
    expect((await patchProfile(cookies, { color: 'red', admin: true })).status).toBe(400);
  });

  it('changes only the session owner, and a body userId is stripped', async () => {
    const ana = await signedIn();
    const bea = await signedIn('bea@example.com');

    const response = await patchProfile(ana.cookies, { userId: bea.userId, displayName: 'Ana' });

    expect(response.status).toBe(200);
    expect((await stored(ana.userId))?.display_name).toBe('Ana');
    expect((await stored(bea.userId))?.display_name).toBeNull();
    expect(((await getProfile(bea.cookies)).body as ProfileBody).email).toBe('bea@example.com');
  });

  it('answers 401 without a session (sad path)', async () => {
    const response = await patchProfile({}, { displayName: 'Ana' });

    expect(response.status).toBe(401);
  });

  it('answers 403 without the web origin header (sad path)', async () => {
    const { userId, cookies } = await signedIn();

    const response = await request(harness.app)
      .patch('/profile')
      .set('Cookie', cookieHeader(cookies))
      .send({ displayName: 'Ana' });

    expect(response.status).toBe(403);
    expect((await stored(userId))?.display_name).toBeNull();
  });

  it('logs the changed field names and no display name, email or preference value', async () => {
    const { userId, cookies } = await signedIn();
    harness.lines.length = 0;

    const response = await patchProfile(cookies, {
      displayName: 'Zoraida Quispe',
      defaultRateType: 'cripto',
      timeZone: 'europe/madrid',
    });
    expect(response.status).toBe(200);
    await patchProfile(cookies, { email: 'leaky@example.com', displayName: 'Leaky Name' });
    await getProfile(cookies);

    const text = harness.lines.join('\n');
    for (const secret of ['Zoraida', 'Quispe', 'cripto', 'adrid', 'leaky', 'Leaky']) {
      expect(text).not.toContain(secret);
    }
    const updated = logEntries(harness.lines).find((entry) => entry.msg === 'profile updated');
    expect(updated).toMatchObject({
      userId,
      fields: ['displayName', 'defaultRateType', 'timeZone'],
    });
    expect(updated).toHaveProperty('requestId');
  });
});
