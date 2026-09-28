import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Email } from '../../src/identity/domain/email';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import {
  createIdentityHarness,
  logEntries,
  type IdentityHarness,
} from '../helpers/identity-harness';
import {
  ACCESS_COOKIE,
  currentSession,
  parseSetCookies,
  REFRESH_COOKIE,
  seedUser,
  sessionFrom,
  signIn,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const EMAIL = 'ana@example.com';
const PASSWORD = 'a long enough passphrase';
const GOOGLE_EMAIL = 'google@gmail.com';
const FIFTEEN_MINUTES = 15 * 60 * 1000;

/** Moves the clock to the start of the next 15-minute window, so a loop never straddles two. */
function startOfNextWindow(harness: IdentityHarness): void {
  const now = harness.clock.now().getTime();
  harness.clock.advance(FIFTEEN_MINUTES - (now % FIFTEEN_MINUTES));
}

async function sessionRows(): Promise<{ user_id: string; revoked_at: Date | null }[]> {
  const result = await connection.pool.query<{ user_id: string; revoked_at: Date | null }>(
    'select user_id, revoked_at from sessions',
  );
  return result.rows;
}

describe('POST /auth/sign-in', () => {
  it('gives a verified user a session and both cookies with HttpOnly, Secure, SameSite=Strict (AC-07, NFR-05)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });

    const response = await signIn(harness.app, ' ANA@example.com ', PASSWORD);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: { id: userId, email: EMAIL, emailVerified: true, language: 'es' },
    });
    const cookies = parseSetCookies(response);
    const access = cookies.get(ACCESS_COOKIE);
    const refreshCookie = cookies.get(REFRESH_COOKIE);
    for (const cookie of [access, refreshCookie]) {
      expect(cookie?.attributes.httponly).toBe(true);
      expect(cookie?.attributes.secure).toBe(true);
      expect(cookie?.attributes.samesite).toBe('Strict');
      // Host-only: never scoped to a Domain (NFR-11).
      expect(cookie?.attributes.domain).toBeUndefined();
    }
    expect(access?.attributes.path).toBe('/');
    expect(refreshCookie?.attributes.path).toBe('/auth');
    // The access token is a 15-minute JWT; the refresh token is opaque.
    expect(access?.attributes['max-age']).toBe('900');
    expect(access?.value.split('.')).toHaveLength(3);
    expect(refreshCookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await sessionRows()).toEqual([{ user_id: userId, revoked_at: null }]);

    // The session works right away.
    const session = await currentSession(harness.app, sessionFrom(response));
    expect(session.status).toBe(200);
    expect(session.body).toEqual({
      user: {
        id: userId,
        email: EMAIL,
        emailVerified: true,
        language: 'es',
        timeZone: 'America/Cordoba',
      },
    });
  });

  it('gives an unverified user a session too, so they can resend the verification email', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const userId = await seedUser(connection, {
      email: EMAIL,
      password: PASSWORD,
      verified: false,
      language: 'en',
    });

    const response = await signIn(harness.app, EMAIL, PASSWORD);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: { id: userId, email: EMAIL, emailVerified: false, language: 'en' },
    });
  });

  it('answers a wrong password and an unknown email with the same status and body (AC-08, NFR-08)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });

    const wrongPassword = await signIn(harness.app, EMAIL, 'not the right passphrase');
    const unknownEmail = await signIn(harness.app, 'nobody@example.com', PASSWORD);

    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual({ code: 'INVALID_CREDENTIALS' });
    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.text).toBe(wrongPassword.text);
    expect(unknownEmail.headers['content-type']).toBe(wrongPassword.headers['content-type']);
    expect(parseSetCookies(wrongPassword).size).toBe(0);
    expect(parseSetCookies(unknownEmail).size).toBe(0);
    expect(await sessionRows()).toEqual([]);
  });

  it('answers a password sign-in for a password-less (Google) user like a wrong password, keeping the reserved units', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    await new DrizzleUserRepository(connection.db).create({
      email: Email.parse(GOOGLE_EMAIL),
      passwordHash: null,
      emailVerifiedAt: new Date(),
      defaultRateType: 'mep',
      displayCurrency: 'ARS',
      timeZone: 'America/Cordoba',
      language: 'es',
    });

    const wrongPassword = await signIn(harness.app, EMAIL, 'not the right passphrase');
    const passwordLess = await signIn(harness.app, GOOGLE_EMAIL, PASSWORD);

    expect(passwordLess.status).toBe(401);
    expect(passwordLess.body).toEqual({ code: 'INVALID_CREDENTIALS' });
    expect(passwordLess.text).toBe(wrongPassword.text);
    expect(passwordLess.headers['content-type']).toBe(wrongPassword.headers['content-type']);
    expect(parseSetCookies(passwordLess).size).toBe(0);
    expect(await sessionRows()).toEqual([]);
    const reserved = await connection.pool.query<{ count: number }>(
      "select count from auth_attempts where kind = 'sign_in_account' and key = $1",
      [GOOGLE_EMAIL],
    );
    expect(reserved.rows).toEqual([{ count: 1 }]);
  });

  it('returns 429 on the 6th failure for one account within 15 min, identical for a non-existent email (NFR-03)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    startOfNextWindow(harness);

    const existing: number[] = [];
    const missing: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      existing.push((await signIn(harness.app, EMAIL, 'wrong passphrase')).status);
      missing.push((await signIn(harness.app, 'ghost@example.com', 'wrong passphrase')).status);
    }
    // The limit holds even with the right password: brute force cannot confirm a guess.
    const sixthExisting = await signIn(harness.app, EMAIL, PASSWORD);
    const sixthMissing = await signIn(harness.app, 'ghost@example.com', PASSWORD);

    expect(existing).toEqual([401, 401, 401, 401, 401]);
    expect(missing).toEqual([401, 401, 401, 401, 401]);
    expect(sixthExisting.status).toBe(429);
    expect(sixthExisting.body).toEqual({ code: 'RATE_LIMITED' });
    expect(sixthMissing.status).toBe(429);
    expect(sixthMissing.text).toBe(sixthExisting.text);
    expect(await sessionRows()).toEqual([]);

    // The account key is the normalized email.
    expect((await signIn(harness.app, ' Ana@Example.COM ', PASSWORD)).status).toBe(429);

    // The next window starts clean.
    harness.clock.advance(FIFTEEN_MINUTES);
    expect((await signIn(harness.app, EMAIL, PASSWORD)).status).toBe(200);
  });

  it('returns 429 on the 21st failure from one IP within 15 min (NFR-03)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    startOfNextWindow(harness);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      // A different account each time, so only the IP counter can trip.
      statuses.push((await signIn(harness.app, `user${attempt}@example.com`, 'wrong one')).status);
    }
    const twentyFirst = await signIn(harness.app, EMAIL, PASSWORD);

    expect(statuses).toEqual(Array.from({ length: 20 }, () => 401));
    expect(twentyFirst.status).toBe(429);
    expect(twentyFirst.body).toEqual({ code: 'RATE_LIMITED' });
  });

  it('does not run Argon2id once the limit is reached (R-04)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    startOfNextWindow(harness);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn(harness.app, 'ghost@example.com', 'wrong passphrase');
    }

    const started = performance.now();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await signIn(harness.app, 'ghost@example.com', 'wrong passphrase')).status).toBe(429);
    }
    const limitedMs = performance.now() - started;

    const attempts = await connection.pool.query<{ kind: string; count: number }>(
      "select kind, count from auth_attempts where kind = 'sign_in_account'",
    );
    // Rejected attempts are not counted again: the hash was never computed.
    expect(attempts.rows).toEqual([{ kind: 'sign_in_account', count: 5 }]);
    expect(limitedMs).toBeLessThan(5 * 50);
  });

  it('caps 20 parallel wrong-password sign-ins for one account at 5 guesses; the rest get 429 (R-01, R-04)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    startOfNextWindow(harness);

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, attempt) =>
        signIn(harness.app, EMAIL, `wrong passphrase ${attempt}`),
      ),
    );

    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(15);
    // The account stays locked for the window, even with the right password.
    expect((await signIn(harness.app, EMAIL, PASSWORD)).status).toBe(429);
  });

  it('does not consume a limit unit on a successful sign-in: only failures count', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });
    startOfNextWindow(harness);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await signIn(harness.app, EMAIL, 'wrong passphrase')).status).toBe(401);
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await signIn(harness.app, EMAIL, PASSWORD)).status).toBe(200);
    }

    const counts = await connection.pool.query<{ kind: string; count: number }>(
      'select kind, count from auth_attempts order by kind',
    );
    expect(counts.rows).toEqual([
      { kind: 'sign_in_account', count: 4 },
      { kind: 'sign_in_ip', count: 4 },
    ]);
    // The fifth failure is still a 401; only the sixth is refused.
    expect((await signIn(harness.app, EMAIL, 'wrong passphrase')).status).toBe(401);
    expect((await signIn(harness.app, EMAIL, 'wrong passphrase')).status).toBe(429);
  });

  it('rejects malformed input with VALIDATION_FAILED and never logs the email or password', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    await seedUser(connection, { email: EMAIL, password: PASSWORD });

    const empty = await signIn(harness.app, EMAIL, '');
    expect(empty.status).toBe(400);
    expect(empty.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.password'] });
    const tooLong = await signIn(harness.app, EMAIL, 'x'.repeat(129));
    expect(tooLong.status).toBe(400);

    await signIn(harness.app, EMAIL, PASSWORD);
    await signIn(harness.app, EMAIL, 'wrong passphrase');

    const events = logEntries(harness.lines).map((entry) => entry.msg);
    expect(events).toContain('sign-in succeeded');
    expect(events).toContain('sign-in failed');
    for (const line of harness.lines) {
      expect(line).not.toContain(EMAIL);
      expect(line).not.toContain(PASSWORD);
    }
  });
});
