import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordCheckUnavailable } from '../../src/identity/domain/errors';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createIdentityHarness } from '../helpers/identity-harness';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';
const LOCK_EMOJI = '\u{1F512}';

function register(app: Parameters<typeof request>[0], body: Record<string, unknown>) {
  return request(app).post('/auth/register').set(trustedHeaders).send(body);
}

async function count(table: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(`select count(*) as n from ${table}`);
  return Number(result.rows[0]?.n);
}

interface OutboxRow {
  kind: string;
  to_email: string | null;
  language: string;
  payload: unknown;
  sent_at: Date | null;
}

async function outboxRows(): Promise<OutboxRow[]> {
  const result = await connection.pool.query<OutboxRow>(
    'select kind, to_email, language, payload, sent_at from email_outbox order by created_at',
  );
  return result.rows;
}

describe('POST /auth/register', () => {
  it('creates an unverified user and enqueues one verification email (AC-01)', async () => {
    const { app, worker, transport } = createIdentityHarness(connection);

    const response = await register(app, { email: ' Ana@Example.com ', password: PASSWORD });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'verification_sent' });
    const users = await connection.pool.query<{
      id: string;
      email: string;
      verified: Date | null;
    }>('select id, email, email_verified_at as verified from users');
    expect(users.rows).toEqual([
      { id: expect.any(String) as unknown, email: 'ana@example.com', verified: null },
    ]);
    const userId = users.rows[0]?.id;
    expect(await outboxRows()).toEqual([
      {
        kind: 'verification',
        to_email: 'ana@example.com',
        language: 'es',
        payload: { userId },
        sent_at: null,
      },
    ]);

    await worker.runOnce();

    expect(transport.sentTo('ana@example.com')).toHaveLength(1);
    expect(transport.sent).toHaveLength(1);
  });

  it('rejects a 9-character password and a breached password with their codes (AC-02)', async () => {
    const { app } = createIdentityHarness(connection);

    const short = await register(app, { email: 'ana@example.com', password: '123456789' });
    expect(short.status).toBe(400);
    expect(short.body).toEqual({ code: 'PASSWORD_TOO_SHORT' });

    const breached = await register(app, { email: 'ana@example.com', password: 'password123' });
    expect(breached.status).toBe(400);
    expect(breached.body).toEqual({ code: 'PASSWORD_BREACHED' });

    expect(await count('users')).toBe(0);
    expect(await count('email_outbox')).toBe(0);
  });

  it('answers an existing email with the same 202 body, creates no user and enqueues a discard row (AC-03)', async () => {
    const { app } = createIdentityHarness(connection);
    const first = await register(app, { email: 'ana@example.com', password: PASSWORD });

    const second = await register(app, {
      email: 'ANA@example.com',
      password: 'another passphrase 42',
    });

    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(second.headers['content-type']).toBe(first.headers['content-type']);
    expect(await count('users')).toBe(1);
    const rows = await outboxRows();
    expect(rows.map((row) => row.kind)).toEqual(['verification', 'discard']);
    expect(rows[1]).toMatchObject({ to_email: null, payload: { userId: null } });
  });

  it('stores the time zone and language from the request and the MEP/ARS defaults (AC-18, AC-19, AC-21)', async () => {
    const { app } = createIdentityHarness(connection);

    await register(app, {
      email: 'ana@example.com',
      password: PASSWORD,
      timeZone: 'America/Cordoba',
      language: 'en-US',
    });

    const users = await connection.pool.query(
      'select default_rate_type, display_currency, time_zone, language from users',
    );
    expect(users.rows).toEqual([
      {
        default_rate_type: 'mep',
        display_currency: 'ARS',
        time_zone: 'America/Cordoba',
        language: 'en',
      },
    ]);
    expect((await outboxRows())[0]?.language).toBe('en');
  });

  it('returns 503 and creates nothing when the breach check is unavailable (R-07)', async () => {
    const { app } = createIdentityHarness(connection, {
      breachedPasswordChecker: {
        isBreached: () => Promise.reject(new PasswordCheckUnavailable()),
      },
    });

    const response = await register(app, { email: 'ana@example.com', password: PASSWORD });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ code: 'PASSWORD_CHECK_UNAVAILABLE' });
    expect(await count('users')).toBe(0);
    expect(await count('email_outbox')).toBe(0);
  });

  it('returns 429 on the 6th registration from one IP within an hour, new or existing email alike (NFR-03)', async () => {
    const { app, clock } = createIdentityHarness(connection);
    // Start of the next hour, so the six requests share one fixed window.
    const hour = clock.now();
    hour.setUTCHours(hour.getUTCHours() + 1, 0, 0, 0);
    clock.advance(hour.getTime() - clock.now().getTime());

    const statuses: number[] = [];
    for (const email of [
      'a@example.com',
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'a@example.com',
    ]) {
      statuses.push((await register(app, { email, password: PASSWORD })).status);
    }
    const sixth = await register(app, { email: 'new@example.com', password: PASSWORD });

    expect(statuses).toEqual([202, 202, 202, 202, 202]);
    expect(sixth.status).toBe(429);
    expect(sixth.body).toEqual({ code: 'RATE_LIMITED' });
    expect(await count('users')).toBe(3);

    // The next hour is a new window.
    clock.advance(60 * 60 * 1000);
    expect((await register(app, { email: 'new@example.com', password: PASSWORD })).status).toBe(
      202,
    );
  });

  it('rejects malformed input with VALIDATION_FAILED and no echoed values', async () => {
    const { app } = createIdentityHarness(connection);

    const badEmail = await register(app, { email: 'not-an-email', password: PASSWORD });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body).toMatchObject({ code: 'VALIDATION_FAILED' });

    const tooLong = await register(app, { email: 'ana@example.com', password: 'x'.repeat(129) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.password'] });
    expect(tooLong.text).not.toContain('xxxx');

    const longTimeZone = await register(app, {
      email: 'ana@example.com',
      password: PASSWORD,
      timeZone: 'x'.repeat(65),
    });
    expect(longTimeZone.status).toBe(400);
    expect(await count('users')).toBe(0);
  });

  it('counts password length in code points: 128 emoji are accepted (256 UTF-16 units)', async () => {
    const { app } = createIdentityHarness(connection);

    const response = await register(app, {
      email: 'ana@example.com',
      password: LOCK_EMOJI.repeat(128),
    });

    expect(response.status).toBe(202);
    expect(await count('users')).toBe(1);
  });

  it('never logs the email or the password', async () => {
    const { app, lines } = createIdentityHarness(connection);

    await register(app, { email: 'ana@example.com', password: PASSWORD });

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain('ana@example.com');
      expect(line).not.toContain(PASSWORD);
    }
  });
});
