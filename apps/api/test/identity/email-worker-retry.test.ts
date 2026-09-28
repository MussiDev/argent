import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmailWorker } from '../../src/identity';
import { Email } from '../../src/identity/domain/email';
import { DrizzleOneTimeTokenRepository } from '../../src/identity/infrastructure/db/drizzle-one-time-token-repository';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import {
  EMAIL_MAX_ATTEMPTS,
  EMAIL_RETRY_BASE_DELAY_MS,
} from '../../src/identity/infrastructure/email/email-worker';
import { OutboxEmailSender } from '../../src/identity/infrastructure/email/outbox-email-sender';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import {
  ResendTransport,
  type ResendClient,
  type ResendSendOptions,
} from '../../src/identity/infrastructure/email/transports/resend-transport';
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
const silent = createLogger({ level: 'silent' });
/** Wait after the n-th failure: 30 s, 90 s, 210 s, 450 s. */
const RETRY_DELAYS_MS = [30, 90, 210, 450].map((seconds) => seconds * SECOND_MS);

function capturingLogger() {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  return { lines, logger };
}

async function enqueueVerification(clock: MutableClock, email: string): Promise<string> {
  const user = await new DrizzleUserRepository(connection.db).create({
    email: Email.parse(email),
    passwordHash: 'hash',
    defaultRateType: 'mep',
    displayCurrency: 'ARS',
    timeZone: 'America/Argentina/Buenos_Aires',
    language: 'es',
  });
  await new OutboxEmailSender(connection.db, clock).enqueue({
    kind: 'verification',
    userId: user.id,
    toEmail: email,
    language: 'es',
  });
  return user.id;
}

interface OutboxState {
  id: string;
  attempts: number;
  next_attempt_at: Date | null;
  sent_at: Date | null;
  to_email: string | null;
}

async function outboxRow(): Promise<OutboxState> {
  const result = await connection.pool.query<OutboxState>(
    'select id, attempts, next_attempt_at, sent_at, to_email from email_outbox',
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0] as OutboxState;
}

/** Polls `pg_stat_activity` until some backend waits on a lock of the given kind; returns its pid. */
async function backendWaitingOn(waitEvents: string[]): Promise<number> {
  let pid: number | undefined;
  await expect
    .poll(
      async () => {
        const result = await connection.pool.query<{ pid: number }>(
          `select pid from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'
              and wait_event = any($1::text[])`,
          [waitEvents],
        );
        pid = result.rows[0]?.pid;
        return pid;
      },
      { timeout: 5000, interval: 20 },
    )
    .toBeDefined();
  return pid as number;
}

describe('EmailWorker retry schedule stored in the outbox (NFR-09)', () => {
  it('with two workers polling, a failed row is not retried before its next_attempt_at', async () => {
    const clock = new MutableClock();
    await enqueueVerification(clock, 'ana@example.com');
    const transport = new CapturingTransport();
    transport.failNext(1);
    const workerA = createEmailWorker({ db: connection.db, env, logger: silent, transport, clock });
    const workerB = createEmailWorker({ db: second.db, env, logger: silent, transport, clock });

    await workerA.runOnce();
    expect(transport.attempts).toBe(1);

    // Worker B never saw the failure: only the table can tell it to wait.
    await workerB.runOnce();
    clock.advance(EMAIL_RETRY_BASE_DELAY_MS - 1);
    await Promise.all([workerA.runOnce(), workerB.runOnce()]);
    expect(transport.attempts).toBe(1);

    clock.advance(1);
    await Promise.all([workerB.runOnce(), workerA.runOnce()]);
    expect(transport.attempts).toBe(2);
    expect(transport.sentTo('ana@example.com')).toHaveLength(1);
  });

  it('updates attempts and next_attempt_at together, and fails the row for good after 5 failures', async () => {
    const clock = new MutableClock();
    await enqueueVerification(clock, 'ana@example.com');
    const transport = new CapturingTransport();
    transport.failNext(100);
    const worker = createEmailWorker({ db: connection.db, env, logger: silent, transport, clock });

    expect(EMAIL_MAX_ATTEMPTS).toBe(5);
    for (const [index, delay] of RETRY_DELAYS_MS.entries()) {
      const failedAt = clock.now().getTime();
      await worker.runOnce();
      const row = await outboxRow();
      expect(row).toMatchObject({
        attempts: index + 1,
        sent_at: null,
        to_email: 'ana@example.com',
      });
      expect(row.next_attempt_at?.getTime()).toBe(failedAt + delay);

      clock.advance(delay - 1);
      await worker.runOnce();
      expect(transport.attempts).toBe(index + 1);
      clock.advance(1);
    }

    await worker.runOnce();
    expect(transport.attempts).toBe(EMAIL_MAX_ATTEMPTS);
    expect(await outboxRow()).toMatchObject({
      attempts: EMAIL_MAX_ATTEMPTS,
      next_attempt_at: null,
      sent_at: null,
      to_email: null,
    });

    clock.advance(HOUR_MS);
    await worker.runOnce();
    expect(transport.attempts).toBe(EMAIL_MAX_ATTEMPTS);
  });

  it('schedules a poison row in the same update that counts its attempt', async () => {
    const clock = new MutableClock();
    await connection.pool.query(
      `insert into email_outbox (id, kind, to_email, language, payload, created_at)
       values (gen_random_uuid(), 'verification', 'poison@example.com', 'es',
               '{"userId": "not-a-uuid"}', $1)`,
      [clock.now()],
    );
    const worker = createEmailWorker({
      db: connection.db,
      env,
      logger: silent,
      transport: new CapturingTransport(),
      clock,
    });

    const failedAt = clock.now().getTime();
    expect(await worker.runOnce()).toMatchObject({ failed: 1 });
    const row = await outboxRow();
    expect(row.attempts).toBe(1);
    expect(row.next_attempt_at?.getTime()).toBe(failedAt + EMAIL_RETRY_BASE_DELAY_MS);

    // A second worker instance (fresh memory) does not pick it up before then.
    const other = createEmailWorker({
      db: second.db,
      env,
      logger: silent,
      transport: new CapturingTransport(),
      clock,
    });
    expect(await other.runOnce()).toEqual({ sent: 0, dropped: 0, failed: 0 });
    expect((await outboxRow()).attempts).toBe(1);
  });

  it('the failure update on a row that another worker already sent changes nothing and schedules nothing', async () => {
    const clock = new MutableClock();
    const userId = await enqueueVerification(clock, 'ana@example.com');
    const { id } = await outboxRow();
    const { lines, logger } = capturingLogger();
    const transport = new CapturingTransport();
    const worker = createEmailWorker({ db: connection.db, env, logger, transport, clock });

    // Hold the user's token-issuance lock so the worker stops inside its row transaction.
    let releaseIssuanceLock: () => void = () => undefined;
    const issuanceLockReleased = new Promise<void>((resolve) => {
      releaseIssuanceLock = resolve;
    });
    let issuanceLockHeld: () => void = () => undefined;
    const issuanceLockTaken = new Promise<void>((resolve) => {
      issuanceLockHeld = resolve;
    });
    const holder = second.db.transaction(async (tx) => {
      await new DrizzleOneTimeTokenRepository(tx).lockIssuance(userId, 'email_verification');
      issuanceLockHeld();
      await issuanceLockReleased;
    });
    await issuanceLockTaken;

    const run = worker.runOnce();
    const workerPid = await backendWaitingOn(['advisory']);
    // "Another worker" marks the row sent; it queues behind the row lock the worker holds.
    const markedSent = connection.pool.query(
      'update email_outbox set sent_at = $2, to_email = null, attempts = attempts + 1 where id = $1',
      [id, clock.now()],
    );
    await backendWaitingOn(['transactionid', 'tuple']);
    // The worker's row transaction fails (not a transport failure) and rolls back; the queued
    // update then commits, and only afterwards does the worker record the failed attempt.
    await connection.pool.query('select pg_cancel_backend($1)', [workerPid]);

    expect(await run).toMatchObject({ sent: 0, failed: 1 });
    await markedSent;
    releaseIssuanceLock();
    await holder;

    expect(transport.attempts).toBe(0);
    expect(await outboxRow()).toMatchObject({
      attempts: 1,
      next_attempt_at: null,
      sent_at: expect.any(Date) as unknown,
      to_email: null,
    });
    const entries = logEntries(lines);
    expect(entries).toContainEqual(
      expect.objectContaining({ level: 20, outboxId: id, msg: 'outbox row already handled' }),
    );
    expect(entries.filter((entry) => (entry.level as number) >= 40)).toEqual([]);
  });

  it('sends a new Resend idempotency key per attempt (<row id>:<attempt>), also after a timed-out first attempt', async () => {
    const clock = new MutableClock();
    await enqueueVerification(clock, 'ana@example.com');
    const { id } = await outboxRow();
    const received: ResendSendOptions[] = [];
    const client: ResendClient = {
      emails: {
        send: (_payload, options) => {
          received.push(options);
          // First attempt hangs like a stuck fetch until its signal aborts; then Resend fails once.
          if (received.length === 1) {
            return new Promise((_resolve, reject) => {
              options.signal.addEventListener('abort', () => {
                reject(options.signal.reason as Error);
              });
            });
          }
          if (received.length === 2) {
            return Promise.resolve({
              data: null,
              error: { name: 'application_error', message: 'unavailable', statusCode: 500 },
            });
          }
          return Promise.resolve({ data: { id: 're_ok' }, error: null });
        },
      },
    };
    const transport = new ResendTransport({
      client,
      from: 'Argent <no-reply@argent.test>',
      timeoutMs: 50,
    });
    const worker = createEmailWorker({ db: connection.db, env, logger: silent, transport, clock });

    for (const delay of RETRY_DELAYS_MS.slice(0, 3)) {
      await worker.runOnce();
      clock.advance(delay);
    }

    expect(received[0]?.signal.aborted).toBe(true);
    expect(received.map((options) => options.idempotencyKey)).toEqual([
      `${id}:1`,
      `${id}:2`,
      `${id}:3`,
    ]);
    expect(await outboxRow()).toMatchObject({ attempts: 3, sent_at: expect.any(Date) as unknown });
  });
});
