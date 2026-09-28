import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordCheckUnavailable } from '../../src/identity/domain/errors';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import {
  startFakeGoogleOidc,
  type FakeGoogleIdentity,
  type FakeGoogleOidc,
} from '../fixtures/fake-google-oidc';
import {
  createIdentityHarness,
  LINK_BASE_URL,
  logEntries,
  type IdentityHarness,
  type IdentityHarnessOptions,
} from '../helpers/identity-harness';
import {
  currentSession,
  refresh,
  seedUser,
  parseSetCookies,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const EMAIL = 'ana@example.com';
const PASSWORD = 'a long enough passphrase';
const NEW_PASSWORD = 'a brand new passphrase';
const MINUTE = 60 * 1000;

/** Real sessions, and client IPs taken from X-Forwarded-For so tests can vary them. */
function harnessFor(options: IdentityHarnessOptions = {}): IdentityHarness {
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    env: { TRUST_PROXY: '1' },
    ...options,
  });
  // Rate-limit windows are fixed hours: start at the top of one so a test never crosses a boundary.
  const start = harness.clock.now();
  start.setUTCHours(start.getUTCHours() + 1, 0, 0, 0);
  harness.clock.advance(start.getTime() - harness.clock.now().getTime());
  return harness;
}

function requestReset(harness: IdentityHarness, email: string, ip = '198.51.100.1') {
  return request(harness.app)
    .post('/auth/password-reset/request')
    .set(trustedHeaders)
    .set('X-Forwarded-For', ip)
    .send({ email });
}

function confirmReset(harness: IdentityHarness, token: string, newPassword = NEW_PASSWORD) {
  return request(harness.app)
    .post('/auth/password-reset/confirm')
    .set(trustedHeaders)
    .send({ token, newPassword });
}

/** Requests a reset, lets the worker send it and returns the token read from the sent email. */
async function resetToken(harness: IdentityHarness, email = EMAIL): Promise<string> {
  expect((await requestReset(harness, email)).status).toBe(202);
  await harness.worker.runOnce();
  return harness.transport.lastTokenFor(email);
}

async function signedIn(harness: IdentityHarness, password = PASSWORD): Promise<SessionCookies> {
  const response = await signIn(harness.app, EMAIL, password);
  expect(response.status).toBe(200);
  return sessionFrom(response);
}

async function passwordHash(email = EMAIL): Promise<string> {
  const result = await connection.pool.query<{ password_hash: string }>(
    'select password_hash from users where email = $1',
    [email],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`no user ${email}`);
  return row.password_hash;
}

async function liveSessions(): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    'select count(*) as n from sessions where revoked_at is null',
  );
  return Number(result.rows[0]?.n);
}

interface OutboxRow {
  kind: string;
  to_email: string | null;
  payload: unknown;
}

async function outboxRows(): Promise<OutboxRow[]> {
  const result = await connection.pool.query<OutboxRow>(
    'select kind, to_email, payload from email_outbox order by created_at',
  );
  return result.rows;
}

describe('POST /auth/password-reset/request', () => {
  it('enqueues a tokenless password_reset row for a registered email and a discard row for an unknown one, with identical responses (AC-09, NFR-08)', async () => {
    const harness = harnessFor();
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });

    const registered = await requestReset(harness, ' Ana@Example.com ');
    const unknown = await requestReset(harness, 'nobody@example.com');

    expect(registered.status).toBe(202);
    expect(registered.body).toEqual({ status: 'reset_sent_if_registered' });
    expect(unknown.status).toBe(registered.status);
    expect(unknown.body).toEqual(registered.body);
    expect(unknown.headers['content-type']).toBe(registered.headers['content-type']);
    expect(unknown.headers['content-length']).toBe(registered.headers['content-length']);
    expect(await outboxRows()).toEqual([
      { kind: 'password_reset', to_email: EMAIL, payload: { userId } },
      { kind: 'discard', to_email: null, payload: { userId: null } },
    ]);

    const issuedAt = harness.clock.now();
    await harness.worker.runOnce();

    expect(harness.transport.sent).toHaveLength(1);
    const [email] = harness.transport.sentTo(EMAIL);
    expect(email?.link).toMatch(
      new RegExp(`^${LINK_BASE_URL}/es/reset-password\\?token=[A-Za-z0-9_-]{43}$`),
    );
    // The link lives 60 minutes (NFR-04).
    const tokens = await connection.pool.query<{ purpose: string; expires_at: Date }>(
      'select purpose, expires_at from one_time_tokens',
    );
    expect(tokens.rows).toEqual([
      { purpose: 'password_reset', expires_at: new Date(issuedAt.getTime() + 60 * MINUTE) },
    ]);
    // Single use: the first confirm works, the second does not.
    const token = harness.transport.lastTokenFor(EMAIL);
    expect((await confirmReset(harness, token)).status).toBe(200);
    expect((await confirmReset(harness, token, 'yet another passphrase')).body).toEqual({
      code: 'TOKEN_INVALID',
    });
  });

  it('enqueues a discard row for a registered but unverified email', async () => {
    const harness = harnessFor();
    await seedUser(connection, { email: EMAIL, password: PASSWORD, verified: false });

    const response = await requestReset(harness, EMAIL);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'reset_sent_if_registered' });
    expect(await outboxRows()).toEqual([
      { kind: 'discard', to_email: null, payload: { userId: null } },
    ]);
    await harness.worker.runOnce();
    expect(harness.transport.sent).toEqual([]);
  });

  it('returns 429 on the 6th request for one email within an hour, also for an unknown email (R-09)', async () => {
    const harness = harnessFor();
    await seedUser(connection, { email: EMAIL, password: PASSWORD });

    for (const email of [EMAIL, 'nobody@example.com']) {
      const statuses: number[] = [];
      // A different IP each time, so only the per-email limit can trip.
      for (let i = 1; i <= 5; i += 1) {
        statuses.push((await requestReset(harness, email, `198.51.100.${i + 10}`)).status);
      }
      const sixth = await requestReset(harness, email, '198.51.100.99');

      expect(statuses).toEqual([202, 202, 202, 202, 202]);
      expect(sixth.status).toBe(429);
      expect(sixth.body).toEqual({ code: 'RATE_LIMITED' });
    }
    // The rejected requests enqueued nothing.
    expect(await outboxRows()).toHaveLength(10);

    harness.clock.advance(60 * MINUTE);
    expect((await requestReset(harness, EMAIL, '198.51.100.99')).status).toBe(202);
  });

  it('returns 429 on the 6th request from one IP within an hour, across different emails (R-09)', async () => {
    const harness = harnessFor();

    const statuses: number[] = [];
    for (let i = 1; i <= 5; i += 1) {
      statuses.push((await requestReset(harness, `user${i}@example.com`, '203.0.113.7')).status);
    }
    const sixth = await requestReset(harness, 'user6@example.com', '203.0.113.7');

    expect(statuses).toEqual([202, 202, 202, 202, 202]);
    expect(sixth.status).toBe(429);
    expect(sixth.body).toEqual({ code: 'RATE_LIMITED' });
    expect((await requestReset(harness, 'user6@example.com', '203.0.113.8')).status).toBe(202);
  });

  it('rejects an invalid body with VALIDATION_FAILED and a cross-site request with 403', async () => {
    const harness = harnessFor();

    const invalid = await request(harness.app)
      .post('/auth/password-reset/request')
      .set(trustedHeaders)
      .send({ email: 'not an email' });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ code: 'VALIDATION_FAILED' });

    const crossSite = await request(harness.app)
      .post('/auth/password-reset/request')
      .set('Origin', 'https://evil.example')
      .send({ email: EMAIL });
    expect(crossSite.status).toBe(403);
    expect(await outboxRows()).toEqual([]);
  });
});

describe('POST /auth/password-reset/confirm', () => {
  it('updates the password and revokes every session of the user (AC-10)', async () => {
    const harness = harnessFor();
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const laptop = await signedIn(harness);
    const phone = await signedIn(harness);
    const token = await resetToken(harness);

    const response = await confirmReset(harness, token);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'password_updated' });
    expect(await liveSessions()).toBe(0);
    for (const device of [laptop, phone]) {
      expect((await currentSession(harness.app, device)).status).toBe(401);
      expect((await refresh(harness.app, device)).status).toBe(401);
    }
    expect((await signIn(harness.app, EMAIL, PASSWORD)).status).toBe(401);
    expect((await signIn(harness.app, EMAIL, NEW_PASSWORD)).status).toBe(200);
    // Completions are logged with the account id and never with the token or the password.
    const completed = logEntries(harness.lines).find((entry) => entry.msg === 'password reset');
    expect(completed).toMatchObject({ userId });
    expect(harness.lines.join('\n')).not.toContain(token);
    expect(harness.lines.join('\n')).not.toContain(NEW_PASSWORD);
  });

  it('rejects a token older than 60 minutes and a used one with TOKEN_INVALID, leaving the password unchanged (AC-11, NFR-04)', async () => {
    const harness = harnessFor();
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    await signedIn(harness);

    const expiring = await resetToken(harness);
    const before = await passwordHash();
    harness.clock.advance(61 * MINUTE);
    const expired = await confirmReset(harness, expiring);

    expect(expired.status).toBe(400);
    expect(expired.body).toEqual({ code: 'TOKEN_INVALID' });
    expect(await passwordHash()).toBe(before);
    expect(await liveSessions()).toBe(1);

    const token = await resetToken(harness);
    expect((await confirmReset(harness, token)).status).toBe(200);
    const afterFirstUse = await passwordHash();
    const reused = await confirmReset(harness, token, 'yet another passphrase');

    expect(reused.status).toBe(400);
    expect(reused.body).toEqual({ code: 'TOKEN_INVALID' });
    expect(await passwordHash()).toBe(afterFirstUse);
    expect((await signIn(harness.app, EMAIL, NEW_PASSWORD)).status).toBe(200);
  });

  it('rejects an unknown token with TOKEN_INVALID and a malformed one with VALIDATION_FAILED', async () => {
    const harness = harnessFor();
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const before = await passwordHash();

    const unknown = await confirmReset(harness, 'A'.repeat(43));
    expect(unknown.status).toBe(400);
    expect(unknown.body).toEqual({ code: 'TOKEN_INVALID' });

    const malformed = await confirmReset(harness, `${'A'.repeat(42)}=`);
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.token'] });
    expect(await passwordHash()).toBe(before);
  });

  it('rejects a breached or short new password, changes nothing and keeps the link usable', async () => {
    const harness = harnessFor();
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    await signedIn(harness);
    const token = await resetToken(harness);
    const before = await passwordHash();

    const breached = await confirmReset(harness, token, 'password123');
    const short = await confirmReset(harness, token, 'short');

    expect(breached.status).toBe(400);
    expect(breached.body).toEqual({ code: 'PASSWORD_BREACHED' });
    expect(short.status).toBe(400);
    expect(short.body).toEqual({ code: 'PASSWORD_TOO_SHORT' });
    expect(await passwordHash()).toBe(before);
    expect(await liveSessions()).toBe(1);
    // The token was not consumed by the rejected attempts.
    expect((await confirmReset(harness, token)).status).toBe(200);
  });

  it('answers 503 when the breach check is unavailable and changes nothing (fail-closed)', async () => {
    const harness = harnessFor({
      breachedPasswordChecker: {
        isBreached: () => Promise.reject(new PasswordCheckUnavailable()),
      },
    });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    await signedIn(harness);
    const token = await resetToken(harness);
    const before = await passwordHash();

    const response = await confirmReset(harness, token);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ code: 'PASSWORD_CHECK_UNAVAILABLE' });
    expect(await passwordHash()).toBe(before);
    expect(await liveSessions()).toBe(1);
    const unused = await connection.pool.query<{ used_at: Date | null }>(
      'select used_at from one_time_tokens',
    );
    expect(unused.rows).toEqual([{ used_at: null }]);
  });

  it('lets exactly one of two concurrent confirms with the same token succeed (NFR-04)', async () => {
    const harness = harnessFor();
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const token = await resetToken(harness);
    const other = 'another brand new passphrase';

    const [first, second] = await Promise.all([
      confirmReset(harness, token, NEW_PASSWORD),
      confirmReset(harness, token, other),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 400]);
    const loser = first.status === 400 ? first : second;
    expect(loser.body).toEqual({ code: 'TOKEN_INVALID' });
    const winner = first.status === 200 ? NEW_PASSWORD : other;
    expect((await signIn(harness.app, EMAIL, winner)).status).toBe(200);
    const versions = await connection.pool.query<{ credentials_version: number }>(
      'select credentials_version from users',
    );
    expect(versions.rows).toEqual([{ credentials_version: 1 }]);
  });
});

describe('email worker after a completed reset', () => {
  it('drops a password_reset row created before the reset completed and sends no link', async () => {
    const harness = harnessFor();
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const token = await resetToken(harness);
    harness.clock.advance(MINUTE);
    // A second request, still queued when the first link is used.
    expect((await requestReset(harness, EMAIL, '198.51.100.2')).status).toBe(202);
    harness.clock.advance(MINUTE);
    expect((await confirmReset(harness, token)).status).toBe(200);

    const run = await harness.worker.runOnce();

    expect(run).toEqual({ sent: 0, dropped: 1, failed: 0 });
    expect(harness.transport.sentTo(EMAIL)).toHaveLength(1);
    const tokens = await connection.pool.query<{ used_at: Date | null }>(
      'select used_at from one_time_tokens',
    );
    expect(tokens.rows.every((row) => row.used_at !== null)).toBe(true);

    // A request made after the reset is delivered normally.
    harness.clock.advance(MINUTE);
    expect((await requestReset(harness, EMAIL, '198.51.100.3')).status).toBe(202);
    expect(await harness.worker.runOnce()).toEqual({ sent: 1, dropped: 0, failed: 0 });
    expect(harness.transport.sentTo(EMAIL)).toHaveLength(2);
  });
});

describe('password reset and Google identities (FR-07, threat R-37)', () => {
  let google: FakeGoogleOidc;

  beforeAll(async () => {
    google = await startFakeGoogleOidc();
  });

  afterAll(async () => {
    await google.close();
  });

  async function googleCallback(harness: IdentityHarness, identity: FakeGoogleIdentity) {
    const started = await request(harness.app).get('/auth/google/start').query({ language: 'es' });
    const binding = parseSetCookies(started).get('__Secure-argent_oauth')?.value ?? '';
    const { continueUrl } = await google.consent(started.headers.location as string, identity);
    const target = new URL(continueUrl);
    return request(harness.app)
      .get(`${target.pathname}${target.search}`)
      .set('Cookie', `__Secure-argent_oauth=${binding}`);
  }

  async function identitySubjects(): Promise<string[]> {
    const result = await connection.pool.query<{ subject: string }>(
      'select subject from user_identities order by subject',
    );
    return result.rows.map((row) => row.subject);
  }

  it('removes the non-authoritative Google identity and keeps an authoritative one', async () => {
    const harness = harnessFor({ google });
    const nonAuthoritative = { sub: 'sub-gil', email: 'gil@example.com', emailVerified: true };
    const authoritative = { sub: 'sub-hal', email: 'hal@gmail.com', emailVerified: true };
    const home = `${LINK_BASE_URL}/es`;
    expect((await googleCallback(harness, nonAuthoritative)).headers.location).toBe(home);
    expect((await googleCallback(harness, authoritative)).headers.location).toBe(home);
    expect(await identitySubjects()).toEqual(['sub-gil', 'sub-hal']);

    for (const email of ['gil@example.com', 'hal@gmail.com']) {
      expect((await confirmReset(harness, await resetToken(harness, email))).status).toBe(200);
    }

    expect(await identitySubjects()).toEqual(['sub-hal']);
    expect((await googleCallback(harness, nonAuthoritative)).headers.location).toBe(
      `${LINK_BASE_URL}/es/sign-in?error=google_failed`,
    );
    expect((await googleCallback(harness, authoritative)).headers.location).toBe(home);
    expect((await signIn(harness.app, 'gil@example.com', NEW_PASSWORD)).status).toBe(200);
  });
});
