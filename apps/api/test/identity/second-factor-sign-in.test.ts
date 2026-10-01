import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { CryptoTokenGenerator } from '../../src/identity/infrastructure/security/crypto-token-generator';
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
} from '../helpers/identity-harness';
import {
  ACCESS_COOKIE,
  cookieHeader,
  currentSession,
  parseSetCookies,
  REFRESH_COOKIE,
  seedUser,
  sessionFrom,
  signIn,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import {
  CHALLENGE_COOKIE,
  challengeFrom,
  seedTwoFactor,
  STEP_MS,
  totpNow,
  UNKNOWN_RECOVERY_CODE,
  unusedRecoveryCodes,
  verifySecondFactor,
  wrongTotp,
  type SeededTwoFactor,
} from '../helpers/two-factor-client';

let connection: DatabaseConnection;
let google: FakeGoogleOidc;

beforeAll(async () => {
  connection = createDatabase(testDatabaseUrl);
  google = await startFakeGoogleOidc();
});

afterAll(async () => {
  await google.close();
  await connection.pool.end();
});

const EMAIL = 'ana@example.com';
const GMAIL = 'ana@gmail.com';
const PASSWORD = 'a long enough passphrase';
const NEW_PASSWORD = 'a brand new passphrase';
const MINUTE = 60 * 1000;
const FIFTEEN_MINUTES = 15 * MINUTE;
const DAY = 24 * 60 * MINUTE;
const CHALLENGE_TTL = 5 * MINUTE;
const BINDING_COOKIE = '__Secure-argent_oauth';
const DEVICE = { timeZone: 'America/Cordoba', language: 'en' };

// --- Fixtures -----------------------------------------------------------------------------------

/** Real sessions and the fake Google server; the clock starts at the top of a 15-minute window. */
function harnessFor(): IdentityHarness {
  const harness = createIdentityHarness(connection, { realSessions: true, google });
  const now = harness.clock.now().getTime();
  harness.clock.advance(FIFTEEN_MINUTES - (now % FIFTEEN_MINUTES));
  return harness;
}

interface TwoFactorUser extends SeededTwoFactor {
  userId: string;
}

async function twoFactorUser(
  harness: IdentityHarness,
  email = EMAIL,
  language: 'es' | 'en' = 'es',
): Promise<TwoFactorUser> {
  const userId = await seedUser(connection, { email, password: PASSWORD, language });
  return { userId, ...(await seedTwoFactor(connection, userId, harness.clock)) };
}

/** A password sign-in that passed the first factor; resolves the challenge token. */
async function firstFactor(harness: IdentityHarness, email = EMAIL): Promise<string> {
  const response = await signIn(harness.app, email, PASSWORD);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'second_factor_required' });
  return challengeFrom(response);
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(sql, params);
  return Number(result.rows[0]?.n ?? 0);
}

function sessionCount(): Promise<number> {
  return count('select count(*) as n from sessions');
}

function challengeCount(): Promise<number> {
  return count('select count(*) as n from sign_in_challenges');
}

function attempts(kind: string, key?: string): Promise<number> {
  return key === undefined
    ? count('select coalesce(sum(count), 0) as n from auth_attempts where kind = $1', [kind])
    : count('select coalesce(sum(count), 0) as n from auth_attempts where kind = $1 and key = $2', [
        kind,
        key,
      ]);
}

/** Attempts recorded on the challenges still live at the harness clock. */
function liveAttempts(harness: IdentityHarness): Promise<number> {
  return count(
    'select coalesce(sum(attempts), 0) as n from sign_in_challenges where expires_at > $1',
    [harness.clock.now()],
  );
}

/** Units recorded for `key` in the 15-minute window the harness clock is in. */
function currentWindowAttempts(harness: IdentityHarness, kind: string, key: string) {
  const now = harness.clock.now().getTime();
  return count(
    'select coalesce(sum(count), 0) as n from auth_attempts where kind = $1 and key = $2 and window_start = $3',
    [kind, key, new Date(now - (now % FIFTEEN_MINUTES))],
  );
}

function lastUsedStep(userId: string): Promise<number> {
  return count('select last_used_step as n from user_two_factor where user_id = $1', [userId]);
}

function expectNoSessionCookies(response: Response) {
  const cookies = parseSetCookies(response);
  expect(cookies.has(ACCESS_COOKIE)).toBe(false);
  expect(cookies.has(REFRESH_COOKIE)).toBe(false);
}

function expectChallengeCookie(response: Response) {
  const cookie = parseSetCookies(response).get(CHALLENGE_COOKIE);
  expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(cookie?.attributes).toMatchObject({
    httponly: true,
    secure: true,
    samesite: 'Strict',
    path: '/auth/2fa',
    'max-age': '300',
  });
  expect(cookie?.attributes.domain).toBeUndefined();
}

function expectSignedIn(response: Response, user: { id: string; email: string }) {
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    status: 'signed_in',
    user: { id: user.id, email: user.email, emailVerified: true, language: 'es' },
  });
}

function expectChallengeCleared(response: Response) {
  const cleared = parseSetCookies(response).get(CHALLENGE_COOKIE);
  expect(cleared?.value).toBe('');
  expect(cleared?.attributes.path).toBe('/auth/2fa');
}

/** The log entries written with message `msg`. */
function logged(harness: IdentityHarness, msg: string): Record<string, unknown>[] {
  return logEntries(harness.lines).filter((entry) => entry.msg === msg);
}

function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.body).toMatchObject({ code });
}

// --- Google -------------------------------------------------------------------------------------

async function googleSignIn(harness: IdentityHarness, identity: FakeGoogleIdentity) {
  const started = await request(harness.app).get('/auth/google/start').query(DEVICE);
  expect(started.status).toBe(302);
  const binding = parseSetCookies(started).get(BINDING_COOKIE)?.value ?? '';
  const { continueUrl } = await google.consent(started.headers.location as string, identity);
  const target = new URL(continueUrl);
  return request(harness.app)
    .get(`${target.pathname}${target.search}`)
    .set('Cookie', `${BINDING_COOKIE}=${binding}`);
}

// --- Tests --------------------------------------------------------------------------------------

describe('second step of a password sign-in (AC-04)', () => {
  it('a password sign-in for a user with 2FA answers second_factor_required, sets the challenge cookie and creates no session; a valid TOTP code then starts the session (AC-04)', async () => {
    const harness = harnessFor();
    const { userId, secret } = await twoFactorUser(harness);

    const first = await signIn(harness.app, EMAIL, PASSWORD);

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ status: 'second_factor_required' });
    expectChallengeCookie(first);
    expectNoSessionCookies(first);
    expect(await sessionCount()).toBe(0);
    // Only the hash of the token is stored (threat R-43).
    const token = challengeFrom(first);
    expect(
      await count('select count(*) as n from sign_in_challenges where token_hash = $1', [token]),
    ).toBe(0);
    expect(await challengeCount()).toBe(1);

    const code = totpNow(secret, harness.clock);
    const second = await verifySecondFactor(harness.app, token, code);

    expectSignedIn(second, { id: userId, email: EMAIL });
    const cookies = sessionFrom(second);
    expect((await currentSession(harness.app, cookies)).status).toBe(200);
    // The challenge is spent and its cookie cleared.
    expect(await challengeCount()).toBe(0);
    const cleared = parseSetCookies(second).get(CHALLENGE_COOKIE);
    expect(cleared?.value).toBe('');
    expect(cleared?.attributes.path).toBe('/auth/2fa');
    // The per-user units of a success go back.
    expect(await attempts('second_factor_user_15m')).toBe(0);
    expect(await attempts('second_factor_user_24h')).toBe(0);
    // No log line carries the code or the challenge token.
    const log = harness.lines.join('\n');
    expect(log).not.toContain(token);
    expect(log).not.toContain(`"${code}"`);
    // Every verify outcome is logged with the user id and the first factor used (threat model).
    expect(logged(harness, 'sign-in succeeded with a second factor')).toEqual([
      expect.objectContaining({ userId, via: 'password' }),
    ]);
  });

  it('a TOTP code already used for a sign-in is refused on the next challenge (NFR-03, sad path)', async () => {
    const harness = harnessFor();
    const { userId, secret } = await twoFactorUser(harness);
    const code = totpNow(secret, harness.clock);
    expectSignedIn(await verifySecondFactor(harness.app, await firstFactor(harness), code), {
      id: userId,
      email: EMAIL,
    });

    const replayed = await verifySecondFactor(harness.app, await firstFactor(harness), code);

    expectError(replayed, 401, 'SECOND_FACTOR_INVALID');
    expectNoSessionCookies(replayed);
    expect(await sessionCount()).toBe(1);
  });
});

describe('second step of a Google sign-in (AC-06)', () => {
  it('a Google sign-in for an existing user with 2FA redirects to the second-factor screen with the challenge cookie and no session; a valid code then starts the session (AC-06)', async () => {
    const harness = harnessFor();
    const { userId, secret } = await twoFactorUser(harness, GMAIL);

    const callback = await googleSignIn(harness, {
      sub: 'sub-ana',
      email: GMAIL,
      emailVerified: true,
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe(`${LINK_BASE_URL}/es/sign-in/second-factor`);
    expectChallengeCookie(callback);
    expectNoSessionCookies(callback);
    expect(await sessionCount()).toBe(0);

    const verified = await verifySecondFactor(
      harness.app,
      challengeFrom(callback),
      totpNow(secret, harness.clock),
    );

    expectSignedIn(verified, { id: userId, email: GMAIL });
    expect((await currentSession(harness.app, sessionFrom(verified))).status).toBe(200);
    expect(logged(harness, 'sign-in succeeded with a second factor')).toEqual([
      expect.objectContaining({ userId, via: 'google' }),
    ]);
  });

  it('users without 2FA still sign in in one step with password and with Google (regression)', async () => {
    const harness = harnessFor();
    const userId = await seedUser(connection, { email: GMAIL, password: PASSWORD });

    const password = await signIn(harness.app, GMAIL, PASSWORD);
    expectSignedIn(password, { id: userId, email: GMAIL });
    expect(parseSetCookies(password).has(CHALLENGE_COOKIE)).toBe(false);
    expect((await currentSession(harness.app, sessionFrom(password))).status).toBe(200);

    const viaGoogle = await googleSignIn(harness, {
      sub: 'sub-ana',
      email: GMAIL,
      emailVerified: true,
    });
    expect(viaGoogle.status).toBe(302);
    expect(viaGoogle.headers.location).toBe(`${LINK_BASE_URL}/es`);
    expect(parseSetCookies(viaGoogle).has(CHALLENGE_COOKIE)).toBe(false);
    expect((await currentSession(harness.app, sessionFrom(viaGoogle))).status).toBe(200);
    expect(await challengeCount()).toBe(0);
  });
});

describe('recovery codes at the second step (AC-04, AC-05)', () => {
  it('an unused recovery code starts the session once and is refused the second time; the unused count drops by one (AC-04, AC-05)', async () => {
    const harness = harnessFor();
    const { userId, recoveryCodes } = await twoFactorUser(harness);
    const code = recoveryCodes[3] ?? '';
    // Typed loosely: lower case, spaces instead of the dash.
    const typed = code.toLowerCase().replace('-', ' ');

    const first = await verifySecondFactor(harness.app, await firstFactor(harness), typed);

    expectSignedIn(first, { id: userId, email: EMAIL });
    expect(await unusedRecoveryCodes(connection, userId)).toBe(9);

    const again = await verifySecondFactor(harness.app, await firstFactor(harness), code);

    expectError(again, 401, 'SECOND_FACTOR_INVALID');
    expect(await unusedRecoveryCodes(connection, userId)).toBe(9);
    expect(await sessionCount()).toBe(1);
    expect(logged(harness, 'second factor refused: wrong code')).toEqual([
      expect.objectContaining({ userId, via: 'password' }),
    ]);
    // A submitted recovery code never reaches the logs, in any form it was typed or stored in.
    const log = harness.lines.join('\n');
    for (const form of [code, typed, code.replace('-', ''), code.slice(0, 5), code.slice(6)]) {
      expect(log).not.toContain(form);
    }
  });
});

describe('failed codes (AC-05, NFR-01, NFR-04)', () => {
  it('a wrong TOTP code and a used recovery code are refused with SECOND_FACTOR_INVALID and recorded on sign_in_account: after 3 wrong codes, 2 wrong passwords make the next password attempt answer 429 (AC-05, NFR-01)', async () => {
    const harness = harnessFor();
    const { userId, secret, recoveryCodes } = await twoFactorUser(harness);
    const used = recoveryCodes[0] ?? '';
    expectSignedIn(await verifySecondFactor(harness.app, await firstFactor(harness), used), {
      id: userId,
      email: EMAIL,
    });
    const challenge = await firstFactor(harness);
    // The successful password sign-ins gave their units back.
    expect(await attempts('sign_in_account', EMAIL)).toBe(0);

    const refused = [
      await verifySecondFactor(harness.app, challenge, used),
      await verifySecondFactor(harness.app, challenge, wrongTotp(secret, harness.clock)),
      await verifySecondFactor(harness.app, challenge, UNKNOWN_RECOVERY_CODE),
    ];

    for (const response of refused) {
      expectError(response, 401, 'SECOND_FACTOR_INVALID');
      expectNoSessionCookies(response);
    }
    expect(await attempts('sign_in_account', EMAIL)).toBe(3);
    expect(await attempts('second_factor_user_15m', userId)).toBe(3);
    expect((await signIn(harness.app, EMAIL, 'wrong password 1')).status).toBe(401);
    expect((await signIn(harness.app, EMAIL, 'wrong password 2')).status).toBe(401);
    expectError(await signIn(harness.app, EMAIL, PASSWORD), 429, 'RATE_LIMITED');
  });

  it('5 wrong passwords (account locked for passwords) do not block a valid second factor on an existing challenge (NFR-04)', async () => {
    const harness = harnessFor();
    const { userId, secret } = await twoFactorUser(harness);
    const challenge = await firstFactor(harness);
    for (let n = 0; n < 5; n += 1) {
      expect((await signIn(harness.app, EMAIL, `wrong password ${n}`)).status).toBe(401);
    }
    expectError(await signIn(harness.app, EMAIL, PASSWORD), 429, 'RATE_LIMITED');

    const verified = await verifySecondFactor(
      harness.app,
      challenge,
      totpNow(secret, harness.clock),
    );

    expectSignedIn(verified, { id: userId, email: EMAIL });
  });

  it('the 6th wrong code within 15 minutes and the 21st within 24 hours answer 429, and a refused attempt gives its units back (NFR-04, sad path)', async () => {
    const harness = harnessFor();
    // Start at the top of a UTC day, so the four 15-minute windows below share one 24-hour window.
    const now = harness.clock.now().getTime();
    harness.clock.advance(DAY - (now % DAY));
    const { userId, secret } = await twoFactorUser(harness);
    const units = async () => ({
      short: await currentWindowAttempts(harness, 'second_factor_user_15m', userId),
      day: await attempts('second_factor_user_24h', userId),
    });

    for (let window = 0; window < 4; window += 1) {
      const challenge = await firstFactor(harness);
      for (let n = 0; n < 5; n += 1) {
        expectError(
          await verifySecondFactor(harness.app, challenge, wrongTotp(secret, harness.clock)),
          401,
          'SECOND_FACTOR_INVALID',
        );
      }
      if (window === 0) {
        // The 6th within 15 minutes, even with a valid code: refused before any check.
        const sixth = await verifySecondFactor(
          harness.app,
          challenge,
          totpNow(secret, harness.clock),
        );
        expectError(sixth, 429, 'RATE_LIMITED');
        expect(await units()).toEqual({ short: 5, day: 5 });
        expect(await lastUsedStep(userId)).toBe(0);
      }
      harness.clock.advance(FIFTEEN_MINUTES);
    }
    expect(await units()).toEqual({ short: 0, day: 20 });

    const challenge = await firstFactor(harness);
    const twentyFirst = await verifySecondFactor(
      harness.app,
      challenge,
      wrongTotp(secret, harness.clock),
    );

    expectError(twentyFirst, 429, 'RATE_LIMITED');
    expect(await units()).toEqual({ short: 0, day: 20 });
    // Not a guess: the challenge did not count it either.
    expect(await liveAttempts(harness)).toBe(0);
  });
});

describe('challenges that are missing, expired or used up (sad path)', () => {
  it('verify without the cookie, with an expired challenge, or with a consumed challenge answers SECOND_FACTOR_EXPIRED (sad path)', async () => {
    const harness = harnessFor();
    const { userId, secret } = await twoFactorUser(harness);

    const missing = await verifySecondFactor(
      harness.app,
      undefined,
      totpNow(secret, harness.clock),
    );
    expectError(missing, 401, 'SECOND_FACTOR_EXPIRED');
    expectChallengeCleared(missing);
    const unknown = await verifySecondFactor(
      harness.app,
      'not-a-challenge',
      totpNow(secret, harness.clock),
    );
    expectError(unknown, 401, 'SECOND_FACTOR_EXPIRED');
    expectChallengeCleared(unknown);

    const expiring = await firstFactor(harness);
    harness.clock.advance(CHALLENGE_TTL + 1000);
    const expired = await verifySecondFactor(harness.app, expiring, totpNow(secret, harness.clock));
    expectError(expired, 401, 'SECOND_FACTOR_EXPIRED');
    expectChallengeCleared(expired);
    expect(await lastUsedStep(userId)).toBe(0);

    const consumed = await firstFactor(harness);
    expectSignedIn(
      await verifySecondFactor(harness.app, consumed, totpNow(secret, harness.clock)),
      { id: userId, email: EMAIL },
    );
    harness.clock.advance(STEP_MS);
    const reused = await verifySecondFactor(harness.app, consumed, totpNow(secret, harness.clock));
    expectError(reused, 401, 'SECOND_FACTOR_EXPIRED');
    expectChallengeCleared(reused);
    expect(logged(harness, 'second factor refused: challenge expired')).toHaveLength(4);
    // None of the expired outcomes kept a unit.
    expect(await attempts('second_factor_user_15m')).toBe(0);
    expect(await sessionCount()).toBe(1);
  });

  it('after 5 attempts on one challenge the next one answers SECOND_FACTOR_EXPIRED, even with a valid code: the attempt count persists across requests (sad path)', async () => {
    const harness = harnessFor();
    // Two minutes before a 15-minute boundary: the per-user limit (5 per window) restarts midway,
    // so only the challenge's own cap can refuse the 6th attempt.
    harness.clock.advance(FIFTEEN_MINUTES - 2 * MINUTE);
    const { userId, secret } = await twoFactorUser(harness);
    const challenge = await firstFactor(harness);

    for (let n = 0; n < 3; n += 1) {
      expectError(
        await verifySecondFactor(harness.app, challenge, wrongTotp(secret, harness.clock)),
        401,
        'SECOND_FACTOR_INVALID',
      );
    }
    harness.clock.advance(2.5 * MINUTE);
    for (let n = 0; n < 2; n += 1) {
      expectError(
        await verifySecondFactor(harness.app, challenge, wrongTotp(secret, harness.clock)),
        401,
        'SECOND_FACTOR_INVALID',
      );
    }
    expect(await liveAttempts(harness)).toBe(5);

    const valid = totpNow(secret, harness.clock);
    const sixth = await verifySecondFactor(harness.app, challenge, valid);

    expectError(sixth, 401, 'SECOND_FACTOR_EXPIRED');
    expectNoSessionCookies(sixth);
    expectChallengeCleared(sixth);
    expect(logged(harness, 'second factor refused: challenge expired')).toEqual([
      expect.objectContaining({ userId, via: 'password', reason: 'too_many_attempts' }),
    ]);
    expect(await challengeCount()).toBe(0);
    // Not a guess: its units went back, and the valid code was not spent.
    expect(await currentWindowAttempts(harness, 'second_factor_user_15m', userId)).toBe(2);
    expect(await lastUsedStep(userId)).toBe(0);
    expectSignedIn(await verifySecondFactor(harness.app, await firstFactor(harness), valid), {
      id: userId,
      email: EMAIL,
    });
  });

  it('a password reset between the first and second factor makes verify answer SECOND_FACTOR_EXPIRED without spending the code (sad path)', async () => {
    const harness = harnessFor();
    const { userId, secret, recoveryCodes } = await twoFactorUser(harness);
    const challenge = await firstFactor(harness);
    const otherChallenge = await firstFactor(harness);
    // What a confirmed reset does to the user row: a new hash and a new credentials version.
    const users = new DrizzleUserRepository(connection.db);
    const user = await users.findById(userId);
    await users.changePassword(userId, user?.passwordHash ?? '', harness.clock.now());

    const code = totpNow(secret, harness.clock);
    expectError(
      await verifySecondFactor(harness.app, challenge, code),
      401,
      'SECOND_FACTOR_EXPIRED',
    );
    const recovery = recoveryCodes[0] ?? '';
    expectError(
      await verifySecondFactor(harness.app, otherChallenge, recovery),
      401,
      'SECOND_FACTOR_EXPIRED',
    );

    expect(await lastUsedStep(userId)).toBe(0);
    expect(await unusedRecoveryCodes(connection, userId)).toBe(10);
    expect(await sessionCount()).toBe(0);
    // A reset does not turn 2FA off: the next sign-in still asks for the second factor.
    expectSignedIn(await verifySecondFactor(harness.app, await firstFactor(harness), code), {
      id: userId,
      email: EMAIL,
    });
  });

  it('a password reset through POST /auth/password-reset/confirm between the factors makes verify answer SECOND_FACTOR_EXPIRED without spending the code; the new password still needs the second factor (sad path)', async () => {
    const harness = harnessFor();
    const { userId, secret } = await twoFactorUser(harness);
    const challenge = await firstFactor(harness);
    const requested = await request(harness.app)
      .post('/auth/password-reset/request')
      .set(trustedHeaders)
      .send({ email: EMAIL });
    expect(requested.status).toBe(202);
    await harness.worker.runOnce();
    const confirmed = await request(harness.app)
      .post('/auth/password-reset/confirm')
      .set(trustedHeaders)
      .send({ token: harness.transport.lastTokenFor(EMAIL), newPassword: NEW_PASSWORD });
    expect(confirmed.status).toBe(200);

    const code = totpNow(secret, harness.clock);
    const refused = await verifySecondFactor(harness.app, challenge, code);

    expectError(refused, 401, 'SECOND_FACTOR_EXPIRED');
    expect(await lastUsedStep(userId)).toBe(0);
    expect(await sessionCount()).toBe(0);
    expect(logged(harness, 'second factor refused: challenge expired')).toEqual([
      expect.objectContaining({ userId, via: 'password', reason: 'credentials_changed' }),
    ]);
    // 2FA stays on: the new password leads to the second step, where the unspent code works.
    const first = await signIn(harness.app, EMAIL, NEW_PASSWORD);
    expect(first.body).toEqual({ status: 'second_factor_required' });
    expectSignedIn(await verifySecondFactor(harness.app, challengeFrom(first), code), {
      id: userId,
      email: EMAIL,
    });
  });

  it('2FA disabled meanwhile makes verify answer SECOND_FACTOR_EXPIRED (sad path)', async () => {
    const harness = harnessFor();
    const { userId, secret } = await twoFactorUser(harness);
    const signedIn = await verifySecondFactor(
      harness.app,
      await firstFactor(harness),
      totpNow(secret, harness.clock),
    );
    const cookies = sessionFrom(signedIn);
    const pending = await firstFactor(harness);
    const lingering = await firstFactor(harness);
    harness.clock.advance(STEP_MS);

    const disabled = await request(harness.app)
      .post('/auth/2fa/disable')
      .set(trustedHeaders)
      .set('Cookie', cookieHeader(cookies))
      .send({ code: totpNow(secret, harness.clock) });
    expect(disabled.status).toBe(204);
    harness.clock.advance(STEP_MS);

    expectError(
      await verifySecondFactor(harness.app, pending, totpNow(secret, harness.clock)),
      401,
      'SECOND_FACTOR_EXPIRED',
    );
    // A challenge that outlived the disable (as if created by a racing sign-in) is refused too.
    await connection.pool.query(
      `insert into sign_in_challenges (token_hash, user_id, credentials_version, via, language, expires_at)
       select $1, id, credentials_version, 'password', 'es', $2 from users where id = $3`,
      [
        new CryptoTokenGenerator().hash(lingering),
        new Date(harness.clock.now().getTime() + MINUTE),
        userId,
      ],
    );
    expectError(
      await verifySecondFactor(harness.app, lingering, totpNow(secret, harness.clock)),
      401,
      'SECOND_FACTOR_EXPIRED',
    );
    expect(await challengeCount()).toBe(0);
    expect(await attempts('second_factor_user_15m', userId)).toBe(0);
  });
});

describe('POST /auth/2fa/verify without an encryption key (sad path)', () => {
  it('answers 503 TWO_FACTOR_UNAVAILABLE and gives the NFR-04 units back; the attempt is not counted on the challenge', async () => {
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      env: { TOTP_ENCRYPTION_KEY: '' },
    });
    const { userId, secret } = await twoFactorUser(harness);
    const challenge = await firstFactor(harness);

    const response = await verifySecondFactor(
      harness.app,
      challenge,
      totpNow(secret, harness.clock),
    );

    expectError(response, 503, 'TWO_FACTOR_UNAVAILABLE');
    expectNoSessionCookies(response);
    expect(await attempts('second_factor_user_15m', userId)).toBe(0);
    expect(await attempts('second_factor_user_24h', userId)).toBe(0);
    expect(await attempts('sign_in_account', EMAIL)).toBe(0);
    expect(await liveAttempts(harness)).toBe(0);
    expect(await lastUsedStep(userId)).toBe(0);
  });
});

describe('POST /auth/2fa/verify input (sad path)', () => {
  it.each([
    ['five digits', '12345'],
    ['seven digits', '1234567'],
    ['letters in a TOTP code', '12a456'],
    ['a recovery code with U', 'UUUUU-UUUUU'],
    ['a recovery code too short', 'ABCDE-1234'],
    ['two dashes', 'AB-CDE-12345'],
    ['too long', '0'.repeat(17)],
    ['a number', 123456],
    ['missing', undefined],
  ])(
    'a code that is neither 6 digits nor a recovery code (%s) answers 400 VALIDATION_FAILED',
    async (_label, code) => {
      const harness = harnessFor();
      const { userId } = await twoFactorUser(harness);
      const challenge = await firstFactor(harness);

      const response = await verifySecondFactor(harness.app, challenge, code);

      expectError(response, 400, 'VALIDATION_FAILED');
      expect(await liveAttempts(harness)).toBe(0);
      expect(await attempts('second_factor_user_15m', userId)).toBe(0);
    },
  );
});
