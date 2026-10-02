import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TWO_FACTOR_DISABLE_USER_24H_POLICY,
  TWO_FACTOR_DISABLE_USER_15M_POLICY,
} from '../../src/identity/application/attempt-policies';
import { Argon2idPasswordHasher } from '../../src/identity/infrastructure/security/argon2id-password-hasher';
import { DrizzleDeletionGrantRepository } from '../../src/identity/infrastructure/db/drizzle-deletion-grant-repository';
import { PostgresAttemptLimiter } from '../../src/identity/infrastructure/db/postgres-attempt-limiter';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createIdentityHarness, type IdentityHarness } from '../helpers/identity-harness';
import {
  cookieHeader,
  currentSession,
  DELETION_GRANT_COOKIE,
  deleteAccount,
  parseSetCookies,
  refresh,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import {
  seedTwoFactor,
  totpNow,
  wrongTotp,
  type SeededTwoFactor,
} from '../helpers/two-factor-client';

let connection: DatabaseConnection;
let harness: IdentityHarness;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

beforeEach(() => {
  harness = createIdentityHarness(connection, { realSessions: true });
  // Start of a 15-minute window, so the counters below never straddle two windows.
  const now = harness.clock.now().getTime();
  harness.clock.advance(FIFTEEN_MINUTES - (now % FIFTEEN_MINUTES));
});

afterAll(async () => {
  await connection.pool.end();
});

const EMAIL = 'ana@example.com';
const PASSWORD = 'a long enough passphrase';
const FIFTEEN_MINUTES = 15 * 60 * 1000;

async function signedIn(
  email = EMAIL,
): Promise<{ userId: string; cookies: SessionCookies; email: string }> {
  const userId = await seedUser(connection, { email, password: PASSWORD });
  const response = await signIn(harness.app, email, PASSWORD);
  expect(response.status).toBe(200);
  return { userId, cookies: sessionFrom(response), email };
}

/** Signs in first (without 2FA), then turns 2FA on straight through the repositories. */
async function signedInWithTwoFactor(): Promise<
  { userId: string; cookies: SessionCookies } & SeededTwoFactor
> {
  const user = await signedIn();
  const twoFactor = await seedTwoFactor(connection, user.userId, harness.clock);
  return { ...user, ...twoFactor };
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(sql, params);
  return Number(result.rows[0]?.n ?? 0);
}

const userExists = async (userId: string): Promise<boolean> =>
  (await count('select count(*) as n from users where id = $1', [userId])) === 1;

async function attempts(kind: string): Promise<number> {
  return count('select coalesce(sum(count), 0) as n from auth_attempts where kind = $1', [kind]);
}

function codeOf(response: request.Response): unknown {
  return (response.body as { code?: unknown }).code;
}

describe('POST /profile/delete with a password', () => {
  it('deletes the account with the right password: 204, the cookies cleared and the old tokens dead (AC-01)', async () => {
    const { userId, cookies } = await signedIn();

    const response = await deleteAccount(harness.app, cookies, { body: { password: PASSWORD } });

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    const cleared = parseSetCookies(response);
    expect(cleared.get('__Host-argent_at')?.value).toBe('');
    expect(cleared.get('__Secure-argent_rt')?.value).toBe('');
    const grantCookie = cleared.get(DELETION_GRANT_COOKIE);
    expect(grantCookie?.value).toBe('');
    expect(grantCookie?.attributes.path).toBe('/profile/delete');
    expect(await userExists(userId)).toBe(false);
    expect((await currentSession(harness.app, cookies)).status).toBe(401);
    expect((await refresh(harness.app, cookies)).status).toBe(401);
  });

  it('frees the email: sign-in fails, registering creates a new account, other users are untouched (AC-01)', async () => {
    const other = await signedIn('bea@example.com');
    const { userId, cookies } = await signedIn();

    expect(
      (await deleteAccount(harness.app, cookies, { body: { password: PASSWORD } })).status,
    ).toBe(204);

    expect((await signIn(harness.app, EMAIL, PASSWORD)).status).toBe(401);
    const registered = await request(harness.app)
      .post('/auth/register')
      .set(trustedHeaders)
      .send({ email: EMAIL, password: PASSWORD, displayName: 'Ana' });
    expect(registered.status).toBe(202);
    const again = await connection.pool.query<{ id: string }>(
      'select id from users where email = $1',
      [EMAIL],
    );
    expect(again.rows).toHaveLength(1);
    expect(again.rows[0]?.id).not.toBe(userId);
    expect(await userExists(other.userId)).toBe(true);
    expect(
      await count('select count(*) as n from sessions where user_id = $1', [other.userId]),
    ).toBe(1);
    expect((await currentSession(harness.app, other.cookies)).status).toBe(200);
  });

  it('answers 401 INVALID_CREDENTIALS for a wrong password, keeps the account and counts one failure (AC-02) (sad path)', async () => {
    const { userId, cookies } = await signedIn();

    const response = await deleteAccount(harness.app, cookies, { body: { password: 'wrong one' } });

    expect(response.status).toBe(401);
    expect(codeOf(response)).toBe('INVALID_CREDENTIALS');
    expect(await userExists(userId)).toBe(true);
    expect(await attempts('sign_in_account')).toBe(1);
    expect(await attempts('sign_in_ip')).toBe(1);
    expect((await currentSession(harness.app, cookies)).status).toBe(200);
  });

  it('answers 401 INVALID_CREDENTIALS without reserving anything when the password is missing (A-1) (sad path)', async () => {
    const { userId, cookies } = await signedIn();

    const response = await deleteAccount(harness.app, cookies, { body: {} });

    expect(response.status).toBe(401);
    expect(codeOf(response)).toBe('INVALID_CREDENTIALS');
    expect(await userExists(userId)).toBe(true);
    expect(await count('select coalesce(sum(count), 0) as n from auth_attempts')).toBe(0);
  });

  it('refunds the units after a successful deletion: only failures count (NFR-02)', async () => {
    const { cookies } = await signedIn();

    await deleteAccount(harness.app, cookies, { body: { password: PASSWORD } });

    expect(await attempts('sign_in_account')).toBe(0);
    expect(await attempts('sign_in_ip')).toBe(0);
  });

  it('answers 429 to the 6th delete attempt and to a password sign-in after 5 wrong passwords, without hashing (AC-02, NFR-02) (sad path)', async () => {
    const { userId, cookies } = await signedIn();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await deleteAccount(harness.app, cookies, { body: { password: 'wrong one' } });
      expect(wrong.status).toBe(401);
    }

    const verify = vi.spyOn(Argon2idPasswordHasher.prototype, 'verify');
    let sixth: request.Response;
    let signInAttempt: request.Response;
    try {
      sixth = await deleteAccount(harness.app, cookies, { body: { password: PASSWORD } });
      signInAttempt = await signIn(harness.app, EMAIL, PASSWORD);
      // Refused before any Argon2id work.
      expect(verify).not.toHaveBeenCalled();
    } finally {
      verify.mockRestore();
    }

    expect(sixth.status).toBe(429);
    expect(codeOf(sixth)).toBe('RATE_LIMITED');
    expect(signInAttempt.status).toBe(429);
    expect(await userExists(userId)).toBe(true);
    // The refused attempts gave their units back: the counter stays at the 5 real failures.
    expect(await attempts('sign_in_account')).toBe(5);
  });

  it('refuses a request without a session with 401, and an oversized password or malformed code with 400, reserving nothing (AC-02) (sad path)', async () => {
    const { userId, cookies } = await signedIn();

    const anonymous = await deleteAccount(harness.app, {}, { body: { password: PASSWORD } });
    const oversized = await deleteAccount(harness.app, cookies, {
      body: { password: 'x'.repeat(129) },
    });
    const malformed = await deleteAccount(harness.app, cookies, {
      body: { password: PASSWORD, secondFactorCode: 'not a code!' },
    });
    const notString = await deleteAccount(harness.app, cookies, { body: { password: 12345 } });

    expect(anonymous.status).toBe(401);
    expect(codeOf(anonymous)).toBe('UNAUTHENTICATED');
    for (const response of [oversized, malformed, notString]) {
      expect(response.status).toBe(400);
      expect(codeOf(response)).toBe('VALIDATION_FAILED');
    }
    expect(await userExists(userId)).toBe(true);
    expect(await count('select coalesce(sum(count), 0) as n from auth_attempts')).toBe(0);
  });

  it('lets an unverified user delete their own data (no verified-email requirement)', async () => {
    const userId = await seedUser(connection, {
      email: EMAIL,
      password: PASSWORD,
      verified: false,
    });
    const cookies = sessionFrom(await signIn(harness.app, EMAIL, PASSWORD));

    const response = await deleteAccount(harness.app, cookies, { body: { password: PASSWORD } });

    expect(response.status).toBe(204);
    expect(await userExists(userId)).toBe(false);
  });
});

describe('POST /profile/delete for an account with a password and a Google link (AC-10)', () => {
  async function liveGrantFor(userId: string): Promise<string> {
    const token = `grant-token-${randomUUID()}`;
    const family = await connection.pool.query<{ family_id: string }>(
      'select family_id from sessions where user_id = $1 limit 1',
      [userId],
    );
    await new DrizzleDeletionGrantRepository(connection.db).replace({
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId,
      sessionFamilyId: family.rows[0]?.family_id ?? '',
      credentialsVersion: 0,
      expiresAt: new Date(harness.clock.now().getTime() + 5 * 60 * 1000),
    });
    return token;
  }

  it('does not delete the account with a live grant cookie and no password (sad path)', async () => {
    const { userId, cookies } = await signedIn();
    await connection.pool.query(
      "insert into user_identities (user_id, provider, subject, email_authoritative) values ($1, 'google', 'sub-ana', true)",
      [userId],
    );
    const grantToken = await liveGrantFor(userId);

    const response = await deleteAccount(harness.app, cookies, { body: {}, grantToken });

    expect(response.status).toBe(401);
    expect(codeOf(response)).toBe('INVALID_CREDENTIALS');
    expect(await userExists(userId)).toBe(true);
    expect(
      await count('select count(*) as n from deletion_grants where user_id = $1', [userId]),
    ).toBe(1);
  });

  it('does not delete it with a live grant cookie and a wrong password either (sad path)', async () => {
    const { userId, cookies } = await signedIn();
    const grantToken = await liveGrantFor(userId);

    const response = await deleteAccount(harness.app, cookies, {
      body: { password: 'wrong one' },
      grantToken,
    });

    expect(response.status).toBe(401);
    expect(await userExists(userId)).toBe(true);
  });
});

describe('POST /profile/delete for an account without a password (no password and no linked Google identity)', () => {
  it('answers 401 REAUTHENTICATION_REQUIRED and keeps the account (sad path)', async () => {
    const { userId, cookies } = await signedIn();
    await connection.pool.query('update users set password_hash = null where id = $1', [userId]);

    const response = await deleteAccount(harness.app, cookies, { body: {} });

    expect(response.status).toBe(401);
    expect(codeOf(response)).toBe('REAUTHENTICATION_REQUIRED');
    expect(await userExists(userId)).toBe(true);
    expect(await count('select coalesce(sum(count), 0) as n from auth_attempts')).toBe(0);
  });
});

describe('POST /profile/delete with two-factor authentication', () => {
  it('deletes with the right password and a valid TOTP code (AC-03)', async () => {
    const { userId, cookies, secret } = await signedInWithTwoFactor();

    const response = await deleteAccount(harness.app, cookies, {
      body: { password: PASSWORD, secondFactorCode: totpNow(secret, harness.clock) },
    });

    expect(response.status).toBe(204);
    expect(await userExists(userId)).toBe(false);
    expect(
      await count('select count(*) as n from user_two_factor where user_id = $1', [userId]),
    ).toBe(0);
    expect(await attempts('two_factor_disable_user')).toBe(0);
  });

  it('deletes with the right password and an unused recovery code, typed as the user sees it (AC-03)', async () => {
    const { userId, cookies, recoveryCodes } = await signedInWithTwoFactor();

    const response = await deleteAccount(harness.app, cookies, {
      body: { password: PASSWORD, secondFactorCode: ` ${recoveryCodes[3] ?? ''} ` },
    });

    expect(response.status).toBe(204);
    expect(await userExists(userId)).toBe(false);
  });

  it('refuses without a code, with a wrong code, a replayed TOTP code and a used recovery code: 400 and the account stays (AC-04) (sad path)', async () => {
    const { userId, cookies, secret, recoveryCodes } = await signedInWithTwoFactor();

    const missing = await deleteAccount(harness.app, cookies, { body: { password: PASSWORD } });
    expect(missing.status).toBe(400);
    expect(codeOf(missing)).toBe('TOTP_INVALID');
    // A missing code is not a guess: nothing reserved for the second factor.
    expect(await attempts('two_factor_disable_user')).toBe(0);

    const wrong = await deleteAccount(harness.app, cookies, {
      body: { password: PASSWORD, secondFactorCode: wrongTotp(secret, harness.clock) },
    });
    expect(wrong.status).toBe(400);
    expect(codeOf(wrong)).toBe('TOTP_INVALID');
    // A wrong code is counted in the disable policy and in the sign-in account policy (NFR-01).
    expect(await attempts('two_factor_disable_user')).toBe(1);
    expect(await attempts('sign_in_account')).toBe(1);

    await connection.pool.query(
      'update user_two_factor set last_used_step = $2 where user_id = $1',
      [userId, Math.floor(harness.clock.now().getTime() / 30_000) + 1],
    );
    const replayed = await deleteAccount(harness.app, cookies, {
      body: { password: PASSWORD, secondFactorCode: totpNow(secret, harness.clock) },
    });
    expect(replayed.status).toBe(400);
    expect(codeOf(replayed)).toBe('TOTP_INVALID');

    await connection.pool.query('update recovery_codes set used_at = now() where user_id = $1', [
      userId,
    ]);
    const used = await deleteAccount(harness.app, cookies, {
      body: { password: PASSWORD, secondFactorCode: recoveryCodes[0] ?? '' },
    });
    expect(used.status).toBe(400);
    expect(codeOf(used)).toBe('TOTP_INVALID');
    expect(await userExists(userId)).toBe(true);
  });

  it('checks the password before the second factor: a wrong password with a valid code is 401 and spends nothing (sad path)', async () => {
    const { userId, cookies, secret } = await signedInWithTwoFactor();

    const response = await deleteAccount(harness.app, cookies, {
      body: { password: 'wrong one', secondFactorCode: totpNow(secret, harness.clock) },
    });

    expect(response.status).toBe(401);
    expect(codeOf(response)).toBe('INVALID_CREDENTIALS');
    expect(await attempts('two_factor_disable_user')).toBe(0);
    expect(await userExists(userId)).toBe(true);
  });

  it('answers 429 to the 6th wrong code within 15 minutes without checking the code (AC-05, NFR-02) (sad path)', async () => {
    const { userId, cookies, secret } = await signedInWithTwoFactor();
    const limiter = new PostgresAttemptLimiter(connection.db, harness.clock);
    for (let n = 0; n < TWO_FACTOR_DISABLE_USER_15M_POLICY.limit; n += 1) {
      await limiter.record(TWO_FACTOR_DISABLE_USER_15M_POLICY, userId);
    }

    const response = await deleteAccount(harness.app, cookies, {
      body: { password: PASSWORD, secondFactorCode: totpNow(secret, harness.clock) },
    });

    expect(response.status).toBe(429);
    expect(codeOf(response)).toBe('RATE_LIMITED');
    expect(await userExists(userId)).toBe(true);
    // The valid code was not even checked: its step was not spent.
    expect(
      await count(
        'select coalesce(last_used_step, 0) as n from user_two_factor where user_id = $1',
        [userId],
      ),
    ).toBe(0);
    expect(await attempts('two_factor_disable_user')).toBe(5);
  });

  it('ends five wrong codes in a row with a 429 for the sixth request (AC-05) (sad path)', async () => {
    const { userId, cookies, secret } = await signedInWithTwoFactor();
    const statuses: number[] = [];
    for (let n = 0; n < 6; n += 1) {
      const response = await deleteAccount(harness.app, cookies, {
        body: { password: PASSWORD, secondFactorCode: wrongTotp(secret, harness.clock) },
      });
      statuses.push(response.status);
    }

    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
    expect(await userExists(userId)).toBe(true);
  });

  it('answers 429 to the 21st wrong code within 24 hours without checking the code (AC-05, NFR-02) (sad path)', async () => {
    const { userId, cookies, secret } = await signedInWithTwoFactor();
    const limiter = new PostgresAttemptLimiter(connection.db, harness.clock);
    for (let n = 0; n < TWO_FACTOR_DISABLE_USER_24H_POLICY.limit; n += 1) {
      await limiter.record(TWO_FACTOR_DISABLE_USER_24H_POLICY, userId);
    }

    const response = await deleteAccount(harness.app, cookies, {
      body: { password: PASSWORD, secondFactorCode: totpNow(secret, harness.clock) },
    });

    expect(response.status).toBe(429);
    expect(await userExists(userId)).toBe(true);
    expect(await attempts('two_factor_disable_user_24h')).toBe(20);
  });

  it('answers 503 TWO_FACTOR_UNAVAILABLE when the encryption key is missing and keeps the account (sad path)', async () => {
    const keyless = createIdentityHarness(connection, {
      realSessions: true,
      env: { TOTP_ENCRYPTION_KEY: '' },
    });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = sessionFrom(await signIn(keyless.app, EMAIL, PASSWORD));
    const { secret } = await seedTwoFactor(connection, userId, keyless.clock);

    const response = await deleteAccount(keyless.app, cookies, {
      body: { password: PASSWORD, secondFactorCode: totpNow(secret, keyless.clock) },
    });

    expect(response.status).toBe(503);
    expect(codeOf(response)).toBe('TWO_FACTOR_UNAVAILABLE');
    expect(await userExists(userId)).toBe(true);
  });
});

describe('deletion log lines (AC-01)', () => {
  it('carry the user id and never the email, password, code or grant', async () => {
    const { userId, cookies, secret } = await signedInWithTwoFactor();
    const code = totpNow(secret, harness.clock);
    const grantToken = 'grant-token-that-must-not-be-logged';
    harness.lines.length = 0;

    const response = await deleteAccount(harness.app, cookies, {
      body: { password: PASSWORD, secondFactorCode: code },
      grantToken,
    });

    expect(response.status).toBe(204);
    const text = harness.lines.join('\n');
    expect(text).toContain(userId);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(grantToken);
    expect(text).not.toContain(`"${code}"`);
    expect(text).not.toContain(cookieHeader(cookies));
    expect(text).not.toContain(cookies.refreshToken);
  });
});
