import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import {
  createIdentityHarness,
  logEntries,
  type IdentityHarness,
} from '../helpers/identity-harness';
import {
  ACCESS_COOKIE,
  cookieHeader,
  currentSession,
  parseSetCookies,
  refresh,
  REFRESH_COOKIE,
  seedUser,
  sessionFrom,
  signIn,
  signOut,
  signOutAll,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { testEnv, trustedHeaders } from '../helpers/test-env';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const EMAIL = 'ana@example.com';
const PASSWORD = 'a long enough passphrase';
const DAY = 24 * 60 * 60 * 1000;
const JWT_SECRET = testEnv().JWT_SECRET;

async function signedIn(harness: IdentityHarness, email = EMAIL): Promise<SessionCookies> {
  const response = await signIn(harness.app, email, PASSWORD);
  expect(response.status).toBe(200);
  return sessionFrom(response);
}

interface SessionRow {
  id: string;
  family_id: string;
  revoked_at: Date | null;
  replaced_by: string | null;
}

async function sessionRows(): Promise<SessionRow[]> {
  const result = await connection.pool.query<SessionRow>(
    'select id, family_id, revoked_at, replaced_by from sessions order by created_at, id',
  );
  return result.rows;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function decodePart(token: string, index: number): Record<string, unknown> {
  const part = token.split('.')[index] ?? '';
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

const REUSE_WARNING = 'refresh token reused; session family revoked';

function reuseWarnings(harness: IdentityHarness): number {
  return logEntries(harness.lines).filter((entry) => entry.msg === REUSE_WARNING).length;
}

function expectCleared(response: request.Response): void {
  const cookies = parseSetCookies(response);
  for (const [name, path] of [
    [ACCESS_COOKIE, '/'],
    [REFRESH_COOKIE, '/auth'],
  ] as const) {
    const cookie = cookies.get(name);
    expect(cookie?.value).toBe('');
    expect(cookie?.attributes.path).toBe(path);
    expect(new Date(String(cookie?.attributes.expires)).getTime()).toBeLessThanOrEqual(Date.now());
  }
}

describe('GET /auth/session', () => {
  it('returns 401 UNAUTHENTICATED without a session', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });

    const response = await currentSession(harness.app, {});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
  });
});

describe('POST /auth/sign-out', () => {
  it('revokes the current refresh token, clears the cookies and the old access token stops working (AC-12)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = await signedIn(harness);

    const response = await signOut(harness.app, cookies);

    expect(response.status).toBe(204);
    expectCleared(response);
    expect((await sessionRows()).map((row) => row.revoked_at)).toEqual([expect.any(Date)]);
    // The JWT has not expired, but its session row is revoked (R-16).
    const session = await currentSession(harness.app, cookies);
    expect(session.status).toBe(401);
    expect(session.body).toEqual({ code: 'UNAUTHENTICATED' });
    expect((await refresh(harness.app, cookies)).status).toBe(401);
  });

  it('is idempotent: without a session, or twice, it answers 204', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = await signedIn(harness);

    expect((await signOut(harness.app, {})).status).toBe(204);
    expect((await signOut(harness.app, cookies)).status).toBe(204);
    expect((await signOut(harness.app, cookies)).status).toBe(204);
    expect(
      (await signOut(harness.app, { accessToken: 'garbage', refreshToken: 'garbage' })).status,
    ).toBe(204);
  });

  it('revokes the session with only the refresh cookie, e.g. after the access token expired', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = await signedIn(harness);
    harness.clock.advance(20 * 60 * 1000);

    expect((await signOut(harness.app, { refreshToken: cookies.refreshToken })).status).toBe(204);

    expect((await sessionRows()).map((row) => row.revoked_at)).toEqual([expect.any(Date)]);
  });
});

describe('POST /auth/sign-out-all', () => {
  it('revokes every refresh token of the user and leaves other users alone (AC-13)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const anaId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    await seedUser(connection, { email: 'bob@example.com', password: PASSWORD });
    const laptop = await signedIn(harness);
    const phone = await signedIn(harness);
    const bob = await signedIn(harness, 'bob@example.com');

    const response = await signOutAll(harness.app, laptop);

    expect(response.status).toBe(204);
    expectCleared(response);
    const revoked = await connection.pool.query<{ user_id: string; revoked: boolean }>(
      'select user_id, revoked_at is not null as revoked from sessions',
    );
    for (const row of revoked.rows) expect(row.revoked).toBe(row.user_id === anaId);
    expect((await refresh(harness.app, phone)).status).toBe(401);
    expect((await currentSession(harness.app, phone)).status).toBe(401);
    expect((await currentSession(harness.app, bob)).status).toBe(200);
  });

  it('requires a session', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });

    const response = await signOutAll(harness.app, {});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token; reusing the old one revokes the whole family (R-15)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const first = await signedIn(harness);

    const rotated = await refresh(harness.app, first);

    expect(rotated.status).toBe(200);
    expect(rotated.body).toEqual({ status: 'refreshed' });
    const second = sessionFrom(rotated);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.accessToken).not.toBe(first.accessToken);
    const [original, successor] = await sessionRows();
    expect(original).toMatchObject({
      revoked_at: expect.any(Date) as unknown,
      replaced_by: successor?.id,
    });
    expect(successor).toMatchObject({ family_id: original?.family_id, revoked_at: null });
    expect((await currentSession(harness.app, second)).status).toBe(200);

    // The old token shows up again: someone else holds a copy.
    const reuse = await refresh(harness.app, first);

    expect(reuse.status).toBe(401);
    expect(reuse.body).toEqual({ code: 'UNAUTHENTICATED' });
    expectCleared(reuse);
    expect(reuseWarnings(harness)).toBe(1);
    expect((await sessionRows()).every((row) => row.revoked_at !== null)).toBe(true);
    expect((await refresh(harness.app, second)).status).toBe(401);
    expect((await currentSession(harness.app, second)).status).toBe(401);
  });

  it('with two concurrent refreshes of one token, exactly one succeeds and the other is treated as reuse (R-15)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = await signedIn(harness);

    const responses = await Promise.all([
      refresh(harness.app, cookies),
      refresh(harness.app, cookies),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const winner = responses.find((response) => response.status === 200);
    if (!winner) throw new Error('no refresh succeeded');
    // Exactly one successor was kept, and the reuse revoked the family including it.
    const rows = await sessionRows();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.revoked_at !== null)).toBe(true);
    expect((await refresh(harness.app, sessionFrom(winner))).status).toBe(401);
  });

  it('rejects a session idle for 31 days, but not one used 29 days ago (NFR-05)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = await signedIn(harness);

    harness.clock.advance(29 * DAY);
    const kept = await refresh(harness.app, cookies);
    expect(kept.status).toBe(200);
    const rotated = sessionFrom(kept);

    harness.clock.advance(31 * DAY);
    const idle = await refresh(harness.app, rotated);
    expect(idle.status).toBe(401);
    expect(idle.body).toEqual({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a valid access token whose session was idle for 31 days (NFR-05)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = await signedIn(harness);
    expect((await currentSession(harness.app, cookies)).status).toBe(200);

    await connection.pool.query('update sessions set last_used_at = $1', [
      new Date(harness.clock.now().getTime() - 31 * DAY),
    ]);

    expect((await currentSession(harness.app, cookies)).status).toBe(401);
  });

  it('answers 401 without a refresh cookie or with an unknown one', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });

    const missing = await refresh(harness.app, {});
    expect(missing.status).toBe(401);
    expectCleared(missing);
    const unknown = await refresh(harness.app, { refreshToken: 'x'.repeat(43) });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual({ code: 'UNAUTHENTICATED' });
    // A 401 from refresh leaves no stale session cookie behind (A-5).
    expectCleared(unknown);
  });

  it('rejects a token revoked by sign-out without treating it as reuse', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const first = await signedIn(harness);
    const rotated = sessionFrom(await refresh(harness.app, first));
    expect((await signOut(harness.app, rotated)).status).toBe(204);
    const [, signedOut] = await sessionRows();

    const response = await refresh(harness.app, rotated);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
    expectCleared(response);
    expect(reuseWarnings(harness)).toBe(0);
    // Its revocation time is the sign-out's: nothing revoked the family afterwards.
    expect((await sessionRows())[1]?.revoked_at).toEqual(signedOut?.revoked_at);
  });

  it('rejects a token revoked by sign-out-all without treating it as reuse', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const laptop = await signedIn(harness);
    const phone = await signedIn(harness);
    expect((await signOutAll(harness.app, laptop)).status).toBe(204);

    const response = await refresh(harness.app, phone);

    expect(response.status).toBe(401);
    expectCleared(response);
    expect(reuseWarnings(harness)).toBe(0);
  });
});

describe('access token verification (R-14)', () => {
  it('rejects a tampered JWT and an alg:none token', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const bobId = await seedUser(connection, { email: 'bob@example.com', password: PASSWORD });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const { accessToken } = await signedIn(harness);
    const [header = '', , signature = ''] = accessToken.split('.');
    const claims = decodePart(accessToken, 1);
    expect(decodePart(accessToken, 0)).toMatchObject({ alg: 'HS256' });

    // Same signature, payload switched to another user.
    const tampered = `${header}.${base64url(JSON.stringify({ ...claims, sub: bobId }))}.${signature}`;
    // Unsigned token claiming alg "none".
    const none = `${base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${base64url(
      JSON.stringify(claims),
    )}.`;
    // Correctly signed with the right secret, but with another algorithm than the pinned one.
    const hs512Header = base64url(JSON.stringify({ alg: 'HS512', typ: 'JWT' }));
    const hs512Payload = base64url(JSON.stringify(claims));
    const hs512 = `${hs512Header}.${hs512Payload}.${createHmac('sha512', JWT_SECRET)
      .update(`${hs512Header}.${hs512Payload}`)
      .digest('base64url')}`;

    for (const token of [tampered, none, hs512, 'not-a-jwt']) {
      const response = await currentSession(harness.app, { accessToken: token });
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
    }
  });

  it('rejects an access token older than 15 minutes', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = await signedIn(harness);

    // Past the 15 minutes and the 5-second clock tolerance.
    harness.clock.advance(15 * 60 * 1000 + 10_000);

    expect((await currentSession(harness.app, cookies)).status).toBe(401);
    // The refresh token still renews it.
    const renewed = await refresh(harness.app, cookies);
    expect(renewed.status).toBe(200);
    expect((await currentSession(harness.app, sessionFrom(renewed))).status).toBe(200);
  });
});

describe('real requireSession on identity routes', () => {
  it('lets a signed-in unverified user resend the verification email, and rejects anyone else', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD, verified: false });
    const cookies = await signedIn(harness);

    const withSession = await request(harness.app)
      .post('/auth/verification/resend')
      .set(trustedHeaders)
      .set('Cookie', cookieHeader(cookies))
      .send({});
    const withoutSession = await request(harness.app)
      .post('/auth/verification/resend')
      .set(trustedHeaders)
      .set('x-test-user-id', 'anyone')
      .send({});

    expect(withSession.status).toBe(202);
    expect(withoutSession.status).toBe(401);
  });
});
