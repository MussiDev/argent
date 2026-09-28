import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmailWorker } from '../../src/identity';
import type { AttemptPurger } from '../../src/identity/application/ports/attempt-purger';
import { Email } from '../../src/identity/domain/email';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
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
import { LINK_BASE_URL, logEntries } from '../helpers/identity-harness';
import { testDatabaseUrl } from '../helpers/test-database';

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

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;
const env = { WEB_BASE_URL: LINK_BASE_URL };

function capturingLogger() {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  return { lines, logger };
}

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

async function enqueueVerification(clock: MutableClock, email: string, userId?: string) {
  const id = userId ?? (await createUser(email));
  await new OutboxEmailSender(connection.db, clock).enqueue({
    kind: 'verification',
    userId: id,
    toEmail: email,
    language: 'es',
  });
  return id;
}

async function outbox() {
  const result = await connection.pool.query<{
    to_email: string | null;
    attempts: number;
    sent_at: Date | null;
  }>('select to_email, attempts, sent_at from email_outbox order by created_at');
  return result.rows;
}

async function count(sql: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(sql);
  return Number(result.rows[0]?.n);
}

describe('EmailWorker resilience', () => {
  it('leaves a single valid token when two workers send to the same user at once', async () => {
    const clock = new MutableClock();
    const userId = await enqueueVerification(clock, 'ana@example.com');
    await enqueueVerification(clock, 'ana@example.com', userId);
    const transport = new CapturingTransport();
    transport.delayMs = 50;
    const silent = createLogger({ level: 'silent' });
    const workerA = createEmailWorker({ db: connection.db, env, logger: silent, transport, clock });
    const workerB = createEmailWorker({ db: second.db, env, logger: silent, transport, clock });

    await Promise.all([workerA.runOnce(), workerB.runOnce()]);

    expect(transport.sent).toHaveLength(2);
    expect(await count('select count(*) as n from one_time_tokens where used_at is null')).toBe(1);
  });

  it('does not retry an old row on consecutive polls after a failure', async () => {
    const clock = new MutableClock();
    await enqueueVerification(clock, 'ana@example.com');
    // The row has waited far longer than the whole backoff schedule (30 s … 450 s).
    clock.advance(HOUR_MS);
    const transport = new CapturingTransport();
    transport.failNext(100);
    const worker = createEmailWorker({
      db: connection.db,
      env,
      logger: createLogger({ level: 'silent' }),
      transport,
      clock,
    });

    await worker.runOnce();
    for (let i = 0; i < 5; i += 1) {
      clock.advance(SECOND_MS);
      await worker.runOnce();
    }
    expect(transport.attempts).toBe(1);

    clock.advance(EMAIL_RETRY_BASE_DELAY_MS);
    await worker.runOnce();
    expect(transport.attempts).toBe(2);
    await worker.runOnce();
    expect(transport.attempts).toBe(2);
  });

  it('counts a failing (poison) row and keeps delivering the others', async () => {
    const clock = new MutableClock();
    // Older than the good row, so it is picked first; its user id makes every attempt throw.
    await connection.pool.query(
      `insert into email_outbox (id, kind, to_email, language, payload, created_at)
       values (gen_random_uuid(), 'verification', 'poison@example.com', 'es',
               '{"userId": "not-a-uuid"}', now() - interval '1 hour')`,
    );
    await enqueueVerification(clock, 'ana@example.com');
    const transport = new CapturingTransport();
    const { lines, logger } = capturingLogger();
    const worker = createEmailWorker({ db: connection.db, env, logger, transport, clock });

    const run = await worker.runOnce();

    expect(run).toMatchObject({ sent: 1, failed: 1 });
    expect(transport.sentTo('ana@example.com')).toHaveLength(1);
    const poison = await connection.pool.query<{ attempts: number; sent_at: Date | null }>(
      "select attempts, sent_at from email_outbox where payload->>'userId' = 'not-a-uuid'",
    );
    expect(poison.rows).toEqual([{ attempts: 1, sent_at: null }]);
    const failures = logEntries(lines).filter((entry) => entry.msg === 'outbox row failed');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ level: 40, attempts: 1, kind: 'verification' });
    expect(lines.join('\n')).not.toContain('poison@example.com');
    expect(lines.join('\n')).not.toContain('ana@example.com');
  });

  it('stops between rows instead of finishing the whole batch', async () => {
    const clock = new MutableClock();
    for (let i = 0; i < 10; i += 1) await enqueueVerification(clock, `user${i}@example.com`);
    const transport = new CapturingTransport();
    transport.delayMs = 40;
    const worker = createEmailWorker({
      db: connection.db,
      env,
      logger: createLogger({ level: 'silent' }),
      transport,
      clock,
      pollIntervalMs: 20,
    });

    worker.start();
    await expect.poll(() => transport.sent.length, { timeout: 2000 }).toBeGreaterThan(0);
    await worker.stop();
    const sentAtStop = transport.sent.length;

    expect(sentAtStop).toBeLessThan(10);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(transport.sent.length).toBe(sentAtStop);
  });

  it('clears the recipient address once a row is sent or has failed for good', async () => {
    const clock = new MutableClock();
    await enqueueVerification(clock, 'sent@example.com');
    const transport = new CapturingTransport();
    const worker = createEmailWorker({
      db: connection.db,
      env,
      logger: createLogger({ level: 'silent' }),
      transport,
      clock,
    });

    await worker.runOnce();
    expect(await outbox()).toEqual([
      { to_email: null, attempts: 1, sent_at: expect.any(Date) as unknown },
    ]);

    await connection.pool.query('delete from email_outbox');
    await enqueueVerification(clock, 'failing@example.com');
    transport.failNext(100);
    for (let i = 0; i < 10; i += 1) {
      await worker.runOnce();
      clock.advance(HOUR_MS);
    }
    expect(await outbox()).toEqual([
      { to_email: null, attempts: EMAIL_MAX_ATTEMPTS, sent_at: null },
    ]);
  });

  it('purges sent and failed outbox rows older than 7 days, keeping pending and recent ones', async () => {
    const clock = new MutableClock();
    const userId = await createUser('ana@example.com');
    // Done rows have no address left; the pending one still has it (and is sent by this pass).
    const insert = (label: string, sql: string) =>
      connection.pool.query(
        `insert into email_outbox (id, kind, to_email, language, payload, created_at, sent_at, attempts)
         values (gen_random_uuid(), 'verification', $2, 'es', $1, ${sql})`,
        [JSON.stringify({ userId, label }), label === 'old-pending' ? 'ana@example.com' : null],
      );
    await insert('old-sent', "now() - interval '8 days', now() - interval '8 days', 1");
    await insert('old-failed', "now() - interval '8 days', null, 5");
    await insert('recent-sent', "now() - interval '1 day', now() - interval '1 day', 1");
    await insert('recent-failed', "now() - interval '1 day', null, 5");
    await insert('old-pending', "now() - interval '8 days', null, 2");
    const worker = new EmailWorker({
      db: connection.db,
      transport: new CapturingTransport(),
      tokenGenerator: new CryptoTokenGenerator(),
      attemptPurger: { purgeOlderThan: () => Promise.resolve(0) },
      oauthStatePurger: { purgeExpired: () => Promise.resolve(0) },
      clock,
      logger: createLogger({ level: 'silent' }),
      webBaseUrl: LINK_BASE_URL,
    });
    await worker.runOnce();

    const labels = await connection.pool.query<{ label: string }>(
      "select payload->>'label' as label from email_outbox order by 1",
    );
    expect(labels.rows.map((row) => row.label)).toEqual([
      'old-pending',
      'recent-failed',
      'recent-sent',
    ]);
  });

  it('logs a failed purge and still delivers the pass', async () => {
    const clock = new MutableClock();
    await enqueueVerification(clock, 'ana@example.com');
    const transport = new CapturingTransport();
    const { lines, logger } = capturingLogger();
    const failingPurger: AttemptPurger = {
      purgeOlderThan: () => Promise.reject(new Error('purge exploded')),
    };
    const worker = new EmailWorker({
      db: connection.db,
      transport,
      tokenGenerator: new CryptoTokenGenerator(),
      attemptPurger: failingPurger,
      oauthStatePurger: { purgeExpired: () => Promise.resolve(0) },
      clock,
      logger,
      webBaseUrl: LINK_BASE_URL,
    });

    await expect(worker.runOnce()).resolves.toMatchObject({ sent: 1 });

    expect(transport.sent).toHaveLength(1);
    expect(logEntries(lines)).toContainEqual(
      expect.objectContaining({ level: 50, msg: 'retention purge failed' }),
    );
  });
});
