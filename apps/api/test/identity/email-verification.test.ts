import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { TEST_USER_HEADER } from '../fakes/test-session';
import {
  createIdentityHarness,
  LINK_BASE_URL,
  type IdentityHarness,
} from '../helpers/identity-harness';
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
const HOUR = 60 * 60 * 1000;

async function registerAndSend(harness: IdentityHarness, email = EMAIL): Promise<string> {
  const response = await request(harness.app)
    .post('/auth/register')
    .set(trustedHeaders)
    .send({ email, password: PASSWORD, displayName: 'Ana' });
  expect(response.status).toBe(202);
  await harness.worker.runOnce();
  return harness.transport.lastTokenFor(email);
}

function verify(harness: IdentityHarness, token: string) {
  return request(harness.app).post('/auth/verify-email').set(trustedHeaders).send({ token });
}

function resend(harness: IdentityHarness, userId?: string) {
  const call = request(harness.app).post('/auth/verification/resend').set(trustedHeaders);
  if (userId) call.set(TEST_USER_HEADER, userId);
  return call.send({});
}

async function userRow(email = EMAIL): Promise<{ id: string; verified: Date | null }> {
  const result = await connection.pool.query<{ id: string; verified: Date | null }>(
    'select id, email_verified_at as verified from users where email = $1',
    [email],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`no user ${email}`);
  return row;
}

async function count(table: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(`select count(*) as n from ${table}`);
  return Number(result.rows[0]?.n);
}

describe('POST /auth/verify-email', () => {
  it('marks the email verified with a valid token (AC-05)', async () => {
    const harness = createIdentityHarness(connection);
    const token = await registerAndSend(harness);

    const response = await verify(harness, token);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'verified' });
    expect((await userRow()).verified).toBeInstanceOf(Date);
  });

  it('rejects an expired (25 h old) token and an already used one with TOKEN_INVALID (AC-06)', async () => {
    const harness = createIdentityHarness(connection);
    const expiring = await registerAndSend(harness, 'old@example.com');
    const reused = await registerAndSend(harness, 'ana@example.com');

    expect((await verify(harness, reused)).status).toBe(200);
    const second = await verify(harness, reused);
    expect(second.status).toBe(400);
    expect(second.body).toEqual({ code: 'TOKEN_INVALID' });

    harness.clock.advance(25 * HOUR);
    const expired = await verify(harness, expiring);
    expect(expired.status).toBe(400);
    expect(expired.body).toEqual({ code: 'TOKEN_INVALID' });
    expect((await userRow('old@example.com')).verified).toBeNull();
  });

  it('rejects an unknown token with TOKEN_INVALID and a malformed one with VALIDATION_FAILED', async () => {
    const harness = createIdentityHarness(connection);

    const unknown = await verify(harness, 'A'.repeat(43));
    expect(unknown.status).toBe(400);
    expect(unknown.body).toEqual({ code: 'TOKEN_INVALID' });

    for (const token of [
      'A'.repeat(42),
      'A'.repeat(44),
      `${'A'.repeat(42)}=`,
      `${'A'.repeat(42)}+`,
    ]) {
      const malformed = await verify(harness, token);
      expect(malformed.status).toBe(400);
      expect(malformed.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.token'] });
    }
  });

  it('invalidates the first link when a second verification email is sent (AC-06)', async () => {
    const harness = createIdentityHarness(connection);
    const first = await registerAndSend(harness);
    const { id } = await userRow();

    expect((await resend(harness, id)).status).toBe(202);
    await harness.worker.runOnce();
    const second = harness.transport.lastTokenFor(EMAIL);

    expect(second).not.toBe(first);
    expect((await verify(harness, first)).body).toEqual({ code: 'TOKEN_INVALID' });
    expect((await verify(harness, second)).status).toBe(200);
  });

  it('builds email links from WEB_BASE_URL even with a spoofed Host header (R-08)', async () => {
    const harness = createIdentityHarness(connection);

    const response = await request(harness.app)
      .post('/auth/register')
      .set(trustedHeaders)
      .set('Host', 'evil.example')
      .set('X-Forwarded-Host', 'evil.example')
      .set('X-Forwarded-Proto', 'https')
      .send({ email: EMAIL, password: PASSWORD, displayName: 'Ana', language: 'en' });
    expect(response.status).toBe(202);
    await harness.worker.runOnce();

    const [email] = harness.transport.sentTo(EMAIL);
    expect(email?.link).toMatch(
      new RegExp(`^${LINK_BASE_URL}/en/verify-email\\?token=[A-Za-z0-9_-]{43}$`),
    );
    expect(email?.text).not.toContain('evil.example');
    expect(email?.html).not.toContain('evil.example');
  });

  it('stores no plaintext token in any column of email_outbox, one_time_tokens or users (NFR-04, R-05)', async () => {
    const harness = createIdentityHarness(connection);
    const token = await registerAndSend(harness);

    for (const table of ['email_outbox', 'one_time_tokens', 'users']) {
      const rows = await connection.pool.query<{ row: string }>(
        `select t::text as row from ${table} t`,
      );
      expect(rows.rows.length).toBeGreaterThan(0);
      for (const { row } of rows.rows) expect(row).not.toContain(token);
    }
    // What is stored is the SHA-256 of the token.
    const hashes = await connection.pool.query<{ token_hash: string }>(
      'select token_hash from one_time_tokens',
    );
    expect(hashes.rows).toEqual([{ token_hash: createHash('sha256').update(token).digest('hex') }]);
  });
});

describe('POST /auth/verification/resend', () => {
  it('requires a session (401 without one)', async () => {
    const harness = createIdentityHarness(connection);

    const response = await resend(harness);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
  });

  it('returns 429 on the 4th resend within an hour (R-09)', async () => {
    const harness = createIdentityHarness(connection);
    const start = harness.clock.now();
    start.setUTCHours(start.getUTCHours() + 1, 0, 0, 0);
    harness.clock.advance(start.getTime() - harness.clock.now().getTime());
    await registerAndSend(harness);
    const { id } = await userRow();

    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await resend(harness, id)).status);
    const fourth = await resend(harness, id);

    expect(statuses).toEqual([202, 202, 202]);
    expect(fourth.status).toBe(429);
    expect(fourth.body).toEqual({ code: 'RATE_LIMITED' });
    // 1 from registration + 3 resends; the rejected one enqueued nothing.
    expect(await count('email_outbox')).toBe(4);
  });

  it('answers 202 to a verified user and sends nothing', async () => {
    const harness = createIdentityHarness(connection);
    const token = await registerAndSend(harness);
    await verify(harness, token);
    const { id } = await userRow();

    const response = await resend(harness, id);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'verification_sent' });
    expect(await count('email_outbox')).toBe(1);
  });
});
