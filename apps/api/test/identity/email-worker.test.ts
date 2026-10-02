import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmailWorker } from '../../src/identity';
import type { AttemptPurger } from '../../src/identity/application/ports/attempt-purger';
import { Email } from '../../src/identity/domain/email';
import { DrizzleDeletionGrantRepository } from '../../src/identity/infrastructure/db/drizzle-deletion-grant-repository';
import { DrizzleOAuthStateRepository } from '../../src/identity/infrastructure/db/drizzle-oauth-state-repository';
import { DrizzleSignInChallengeRepository } from '../../src/identity/infrastructure/db/drizzle-sign-in-challenge-repository';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { PostgresAttemptLimiter } from '../../src/identity/infrastructure/db/postgres-attempt-limiter';
import {
  EMAIL_MAX_ATTEMPTS,
  EMAIL_RETRY_BASE_DELAY_MS,
  EmailWorker,
} from '../../src/identity/infrastructure/email/email-worker';
import { OutboxEmailSender } from '../../src/identity/infrastructure/email/outbox-email-sender';
import { CryptoTokenGenerator } from '../../src/identity/infrastructure/security/crypto-token-generator';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { CapturingTransport } from '../fakes/capturing-transport';
import { MutableClock } from '../fakes/mutable-clock';
import { createIdentityHarness, LINK_BASE_URL, logEntries } from '../helpers/identity-harness';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';

let connection: DatabaseConnection;
let second: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  second = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
  await second.pool.end();
});

const PASSWORD = 'a long enough passphrase';
const HOUR = 60 * 60 * 1000;
const silent = createLogger({ level: 'silent' });

async function createUser(email: string): Promise<string> {
  const user = await new DrizzleUserRepository(connection.db).create({
    email: Email.parse(email),
    passwordHash: 'hash',
    defaultRateType: 'mep',
    displayCurrency: 'ARS',
    timeZone: 'America/Argentina/Buenos_Aires',
    language: 'es',
  });
  return user.id;
}

async function count(sql: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(sql);
  return Number(result.rows[0]?.n);
}

describe('EmailWorker', () => {
  it('sends pending rows once, drops discard rows, and two workers never send the same row (NFR-09)', async () => {
    const clock = new MutableClock();
    const outbox = new OutboxEmailSender(connection.db, clock);
    const emails = Array.from({ length: 8 }, (_, i) => `user${i}@example.com`);
    for (const email of emails) {
      const userId = await createUser(email);
      await outbox.enqueue({ kind: 'verification', userId, toEmail: email, language: 'es' });
    }
    await outbox.enqueue({ kind: 'discard', userId: null, toEmail: null, language: 'es' });
    await outbox.enqueue({ kind: 'discard', userId: null, toEmail: null, language: 'en' });

    // Two workers on separate connection pools, as two processes would be; a slow transport keeps
    // row locks held long enough for the workers to overlap.
    const transport = new CapturingTransport();
    transport.delayMs = 25;
    const env = { WEB_BASE_URL: LINK_BASE_URL };
    const workerA = createEmailWorker({ db: connection.db, env, logger: silent, transport, clock });
    const workerB = createEmailWorker({ db: second.db, env, logger: silent, transport, clock });

    await Promise.all([workerA.runOnce(), workerB.runOnce()]);

    expect(transport.sent.map((sent) => sent.to).sort()).toEqual([...emails].sort());
    expect(transport.attempts).toBe(8);
    expect(await count("select count(*) as n from email_outbox where kind = 'discard'")).toBe(0);
    expect(await count('select count(*) as n from email_outbox where sent_at is null')).toBe(0);

    // Already sent rows are never sent again.
    await Promise.all([workerA.runOnce(), workerB.runOnce()]);
    expect(transport.attempts).toBe(8);
  });

  it('retries a transport error up to 5 times with backoff and logs it; the HTTP request is unaffected', async () => {
    const harness = createIdentityHarness(connection);
    harness.transport.failNext(100);

    const response = await request(harness.app)
      .post('/auth/register')
      .set(trustedHeaders)
      .send({ email: 'ana@example.com', password: PASSWORD, displayName: 'Ana' });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'verification_sent' });

    expect(EMAIL_MAX_ATTEMPTS).toBe(5);
    await harness.worker.runOnce();
    expect(harness.transport.attempts).toBe(1);

    // Backoff: the n-th retry waits base * (2^n - 1) after the email was queued.
    harness.clock.advance(EMAIL_RETRY_BASE_DELAY_MS - 1);
    await harness.worker.runOnce();
    expect(harness.transport.attempts).toBe(1);
    harness.clock.advance(1);
    await harness.worker.runOnce();
    expect(harness.transport.attempts).toBe(2);
    await harness.worker.runOnce();
    expect(harness.transport.attempts).toBe(2);

    for (let i = 0; i < 10; i += 1) {
      harness.clock.advance(HOUR);
      await harness.worker.runOnce();
    }
    expect(harness.transport.attempts).toBe(5);

    const rows = await connection.pool.query<{ attempts: number; sent_at: Date | null }>(
      'select attempts, sent_at from email_outbox',
    );
    expect(rows.rows).toEqual([{ attempts: 5, sent_at: null }]);

    const entries = logEntries(harness.lines);
    const retries = entries.filter((entry) => entry.msg === 'email delivery failed; will retry');
    const failures = entries.filter((entry) => entry.msg === 'email delivery failed permanently');
    expect(retries).toHaveLength(4);
    expect(retries.every((entry) => entry.level === 40)).toBe(true);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ level: 50, attempts: 5, kind: 'verification' });
    expect(JSON.stringify(failures[0])).toContain('provider unavailable');
    expect(harness.lines.join('\n')).not.toContain('ana@example.com');
  });

  it('leaves no token row after a failed send, and a later successful send issues exactly one valid token', async () => {
    const harness = createIdentityHarness(connection);
    harness.transport.failNext(1);
    await request(harness.app)
      .post('/auth/register')
      .set(trustedHeaders)
      .send({ email: 'ana@example.com', password: PASSWORD, displayName: 'Ana' });

    await harness.worker.runOnce();
    expect(harness.transport.attempts).toBe(1);
    expect(await count('select count(*) as n from one_time_tokens')).toBe(0);

    harness.clock.advance(EMAIL_RETRY_BASE_DELAY_MS);
    await harness.worker.runOnce();

    expect(harness.transport.sent).toHaveLength(1);
    expect(await count('select count(*) as n from one_time_tokens')).toBe(1);
    expect(await count('select count(*) as n from one_time_tokens where used_at is null')).toBe(1);
    const verified = await request(harness.app)
      .post('/auth/verify-email')
      .set(trustedHeaders)
      .send({ token: harness.transport.lastTokenFor('ana@example.com') });
    expect(verified.status).toBe(200);
  });

  it('purges auth_attempts older than 24 h through the AttemptPurger port, at most once per hour (NFR-03)', async () => {
    const clock = new MutableClock(new Date('2026-09-26T12:00:00.000Z'));
    const limiter = new PostgresAttemptLimiter(connection.db, clock);
    const cutoffs: Date[] = [];
    const purger: AttemptPurger = {
      purgeOlderThan: (cutoff) => {
        cutoffs.push(cutoff);
        return limiter.purgeOlderThan(cutoff);
      },
    };
    const policy = { kind: 'register_ip', limit: 5, windowSeconds: 3600 } as const;
    const recordAt = async (iso: string, key: string) => {
      const at = new PostgresAttemptLimiter(connection.db, { now: () => new Date(iso) });
      await at.record(policy, key);
    };
    await recordAt('2026-09-25T11:00:00.000Z', 'old');
    await recordAt('2026-09-26T11:00:00.000Z', 'recent');

    const worker = new EmailWorker({
      db: connection.db,
      transport: new CapturingTransport(),
      tokenGenerator: new CryptoTokenGenerator(),
      attemptPurger: purger,
      oauthStatePurger: { purgeExpired: () => Promise.resolve(0) },
      signInChallengePurger: { purgeExpired: () => Promise.resolve(0) },
      deletionGrantPurger: { purgeExpired: () => Promise.resolve(0) },
      clock,
      logger: silent,
      webBaseUrl: LINK_BASE_URL,
    });
    const keys = async () =>
      (
        await connection.pool.query<{ key: string }>('select key from auth_attempts order by key')
      ).rows.map((row) => row.key);

    await worker.runOnce();
    expect(cutoffs).toEqual([new Date('2026-09-25T12:00:00.000Z')]);
    expect(await keys()).toEqual(['recent']);

    // Within the hour: no purge, even though a stale row appeared.
    await recordAt('2026-09-24T00:00:00.000Z', 'stale');
    clock.advance(59 * 60 * 1000);
    await worker.runOnce();
    expect(cutoffs).toHaveLength(1);
    expect(await keys()).toEqual(['recent', 'stale']);

    clock.advance(60 * 1000);
    await worker.runOnce();
    expect(cutoffs).toHaveLength(2);
    expect(await keys()).toEqual(['recent']);
  });

  it('purges expired oauth_states rows and keeps live ones', async () => {
    const clock = new MutableClock(new Date('2026-09-28T12:00:00.000Z'));
    const states = new DrizzleOAuthStateRepository(connection.db);
    const at = (minutes: number) => new Date(clock.now().getTime() + minutes * 60 * 1000);
    for (const [stateHash, expiresAt] of [
      ['expired', at(-1)],
      ['expiring-now', at(0)],
      ['live', at(1)],
    ] as const) {
      await states.create({
        stateHash,
        bindingHash: 'binding',
        nonceHash: 'nonce',
        codeVerifier: 'verifier',
        timeZone: 'UTC',
        language: 'es',
        expiresAt,
      });
    }
    const worker = createEmailWorker({
      db: connection.db,
      env: { WEB_BASE_URL: LINK_BASE_URL },
      logger: silent,
      transport: new CapturingTransport(),
      clock,
    });

    await worker.runOnce();

    const left = await connection.pool.query<{ state_hash: string }>(
      'select state_hash from oauth_states order by state_hash',
    );
    expect(left.rows.map((row) => row.state_hash)).toEqual(['live']);
  });

  it('purges expired sign_in_challenges rows and keeps live ones', async () => {
    const clock = new MutableClock(new Date('2026-09-30T12:00:00.000Z'));
    const challenges = new DrizzleSignInChallengeRepository(connection.db);
    const userId = await createUser('ana@example.com');
    const at = (minutes: number) => new Date(clock.now().getTime() + minutes * 60 * 1000);
    for (const [tokenHash, expiresAt] of [
      ['expired', at(-1)],
      ['expiring-now', at(0)],
      ['live', at(1)],
    ] as const) {
      await challenges.create({
        tokenHash,
        userId,
        credentialsVersion: 0,
        via: 'password',
        language: 'es',
        expiresAt,
      });
    }
    const worker = createEmailWorker({
      db: connection.db,
      env: { WEB_BASE_URL: LINK_BASE_URL },
      logger: silent,
      transport: new CapturingTransport(),
      clock,
    });

    await worker.runOnce();

    const left = await connection.pool.query<{ token_hash: string }>(
      'select token_hash from sign_in_challenges order by token_hash',
    );
    expect(left.rows.map((row) => row.token_hash)).toEqual(['live']);
  });

  it('purges expired deletion_grants rows and keeps live ones', async () => {
    const clock = new MutableClock(new Date('2026-10-02T12:00:00.000Z'));
    const grants = new DrizzleDeletionGrantRepository(connection.db);
    const at = (minutes: number) => new Date(clock.now().getTime() + minutes * 60 * 1000);
    for (const [tokenHash, expiresAt] of [
      ['expired', at(-1)],
      ['expiring-now', at(0)],
      ['live', at(1)],
    ] as const) {
      const userId = await createUser(`${tokenHash}@example.com`);
      await grants.replace({
        tokenHash,
        userId,
        sessionFamilyId: '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b',
        credentialsVersion: 0,
        expiresAt,
      });
    }
    const worker = createEmailWorker({
      db: connection.db,
      env: { WEB_BASE_URL: LINK_BASE_URL },
      logger: silent,
      transport: new CapturingTransport(),
      clock,
    });

    await worker.runOnce();

    const left = await connection.pool.query<{ token_hash: string }>(
      'select token_hash from deletion_grants order by token_hash',
    );
    expect(left.rows.map((row) => row.token_hash)).toEqual(['live']);
  });

  it('runs every purge even when an earlier one fails, and logs each failure', async () => {
    const clock = new MutableClock(new Date('2026-09-30T12:00:00.000Z'));
    const purged: string[] = [];
    const purgedGrants: string[] = [];
    const lines: string[] = [];
    const logger = createLogger({
      level: 'debug',
      destination: { write: (line: string) => lines.push(line) },
    });
    const worker = new EmailWorker({
      db: connection.db,
      transport: new CapturingTransport(),
      tokenGenerator: new CryptoTokenGenerator(),
      attemptPurger: { purgeOlderThan: () => Promise.reject(new Error('attempts exploded')) },
      oauthStatePurger: { purgeExpired: () => Promise.reject(new Error('states exploded')) },
      signInChallengePurger: {
        purgeExpired: (now) => {
          purged.push(now.toISOString());
          return Promise.resolve(0);
        },
      },
      deletionGrantPurger: {
        purgeExpired: (now) => {
          purgedGrants.push(now.toISOString());
          return Promise.resolve(0);
        },
      },
      clock,
      logger,
      webBaseUrl: LINK_BASE_URL,
    });

    await worker.runOnce();

    expect(purged).toEqual(['2026-09-30T12:00:00.000Z']);
    expect(purgedGrants).toEqual(['2026-09-30T12:00:00.000Z']);
    const failures = logEntries(lines).filter((entry) => entry.msg === 'retention purge failed');
    expect(failures.map((entry) => entry.purge)).toEqual(['attempts', 'oauthStates']);
  });

  it('delivers two_factor_enabled and two_factor_disabled notices through the transport without issuing a token (FR-05)', async () => {
    const clock = new MutableClock();
    const outbox = new OutboxEmailSender(connection.db, clock);
    const ana = await createUser('ana@example.com');
    const bob = await createUser('bob@example.com');
    await outbox.enqueue({
      kind: 'two_factor_enabled',
      userId: ana,
      toEmail: 'ana@example.com',
      language: 'es',
    });
    await outbox.enqueue({
      kind: 'two_factor_disabled',
      userId: bob,
      toEmail: 'bob@example.com',
      language: 'en',
    });
    const transport = new CapturingTransport();
    transport.failNext(1);
    const worker = createEmailWorker({
      db: connection.db,
      env: { WEB_BASE_URL: LINK_BASE_URL },
      logger: silent,
      transport,
      clock,
    });

    // The first send fails and is retried with its own idempotency key, as for token emails.
    expect(await worker.runOnce()).toEqual({ sent: 1, dropped: 0, failed: 1 });
    clock.advance(EMAIL_RETRY_BASE_DELAY_MS);
    expect(await worker.runOnce()).toEqual({ sent: 1, dropped: 0, failed: 0 });

    expect(transport.sent.map((sent) => sent.to).sort()).toEqual([
      'ana@example.com',
      'bob@example.com',
    ]);
    for (const sent of transport.sent) {
      expect(sent.token).toBeUndefined();
      expect(sent.text).not.toMatch(/https?:\/\//);
      expect(sent.html).not.toContain('href');
      expect(sent.subject.length).toBeGreaterThan(0);
    }
    const [anaEmail] = transport.sentTo('ana@example.com');
    const [bobEmail] = transport.sentTo('bob@example.com');
    expect(anaEmail?.subject).not.toBe(bobEmail?.subject);
    const keys = transport.sent.map((sent) => sent.idempotencyKey);
    expect(keys.some((key) => key.endsWith(':2'))).toBe(true);
    expect(await count('select count(*) as n from one_time_tokens')).toBe(0);
    expect(
      await count(
        'select count(*) as n from email_outbox where sent_at is not null and to_email is null',
      ),
    ).toBe(2);
  });

  it('drops a two-factor notice whose user was deleted, without sending', async () => {
    const clock = new MutableClock();
    const userId = await createUser('ana@example.com');
    await new OutboxEmailSender(connection.db, clock).enqueue({
      kind: 'two_factor_disabled',
      userId,
      toEmail: 'ana@example.com',
      language: 'es',
    });
    await connection.pool.query('delete from users where id = $1', [userId]);
    const transport = new CapturingTransport();
    const worker = createEmailWorker({
      db: connection.db,
      env: { WEB_BASE_URL: LINK_BASE_URL },
      logger: silent,
      transport,
      clock,
    });

    expect(await worker.runOnce()).toEqual({ sent: 0, dropped: 1, failed: 0 });

    expect(transport.attempts).toBe(0);
    expect(await count('select count(*) as n from email_outbox')).toBe(0);
  });

  it('drops a verification row whose user is already verified, without sending', async () => {
    const clock = new MutableClock();
    const userId = await createUser('ana@example.com');
    await connection.pool.query('update users set email_verified_at = now() where id = $1', [
      userId,
    ]);
    await new OutboxEmailSender(connection.db, clock).enqueue({
      kind: 'verification',
      userId,
      toEmail: 'ana@example.com',
      language: 'es',
    });
    const transport = new CapturingTransport();
    const worker = createEmailWorker({
      db: connection.db,
      env: { WEB_BASE_URL: LINK_BASE_URL },
      logger: silent,
      transport,
      clock,
    });

    await worker.runOnce();

    expect(transport.attempts).toBe(0);
    expect(await count('select count(*) as n from email_outbox')).toBe(0);
    expect(await count('select count(*) as n from one_time_tokens')).toBe(0);
  });

  it('polls on an interval once started and stops cleanly', async () => {
    const clock = new MutableClock();
    const userId = await createUser('ana@example.com');
    const transport = new CapturingTransport();
    const worker = createEmailWorker({
      db: connection.db,
      env: { WEB_BASE_URL: LINK_BASE_URL },
      logger: silent,
      transport,
      clock,
      pollIntervalMs: 20,
    });

    worker.start();
    await new OutboxEmailSender(connection.db, clock).enqueue({
      kind: 'verification',
      userId,
      toEmail: 'ana@example.com',
      language: 'es',
    });
    await expect.poll(() => transport.sent.length, { timeout: 2000 }).toBe(1);
    await worker.stop();
  });
});
