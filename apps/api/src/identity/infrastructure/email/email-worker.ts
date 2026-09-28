import { and, asc, eq, gte, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Logger } from '../../../shared/logging/logger';
import { issueEmailToken } from '../../application/issue-email-token';
import type { AttemptPurger } from '../../application/ports/attempt-purger';
import type { Clock } from '../../application/ports/clock';
import type { OneTimeTokenPurpose } from '../../application/ports/one-time-token-repository';
import type { TokenGenerator } from '../../application/ports/token-generator';
import { DrizzleOneTimeTokenRepository } from '../db/drizzle-one-time-token-repository';
import { DrizzleUserRepository } from '../db/drizzle-user-repository';
import { emailOutbox, type IdentityDb } from '../db/schema';
import type { EmailTransport, SendResult } from './email-transport';
import { renderEmail, type TokenEmailKind } from './render-email';

export const EMAIL_POLL_INTERVAL_MS = 2_000;
/** After this many failed attempts a row is left unsent for good and logged as failed. */
export const EMAIL_MAX_ATTEMPTS = 5;
/** After the n-th failed attempt the row waits `base * (2^n - 1)`: 30 s, 90 s, 210 s, 450 s. */
export const EMAIL_RETRY_BASE_DELAY_MS = 30_000;
const HOUR_MS = 60 * 60 * 1000;
const ATTEMPTS_RETENTION_MS = 24 * HOUR_MS;
/** Sent and permanently failed outbox rows are deleted after this (their payload names a user). */
export const OUTBOX_RETENTION_MS = 7 * 24 * HOUR_MS;
const PURGE_INTERVAL_MS = HOUR_MS;
const DEFAULT_BATCH_SIZE = 50;

const PURPOSE_BY_KIND: Record<TokenEmailKind, OneTimeTokenPurpose> = {
  verification: 'email_verification',
  password_reset: 'password_reset',
};

export interface EmailWorkerDependencies {
  /** A database, not a transaction: the worker opens one transaction per row. */
  db: IdentityDb;
  transport: EmailTransport;
  tokenGenerator: TokenGenerator;
  attemptPurger: AttemptPurger;
  clock: Clock;
  logger: Logger;
  webBaseUrl: string;
  pollIntervalMs?: number;
  batchSize?: number;
}

export interface EmailWorkerRun {
  sent: number;
  dropped: number;
  failed: number;
}

type RowOutcome = 'sent' | 'dropped' | 'failed' | 'idle';
type OutboxRow = typeof emailOutbox.$inferSelect;
type Transaction = Parameters<Parameters<IdentityDb['transaction']>[0]>[0];

/** Marks a rejection of the transport, as opposed to a database or programming error. */
class TransportFailure extends Error {
  constructor(cause: unknown) {
    super('email transport failed', { cause });
    this.name = 'TransportFailure';
  }
}

/** Any other error while handling one row; carries the row so the pass can count it and go on. */
class RowFailure extends Error {
  constructor(
    readonly outboxId: string,
    readonly kind: OutboxRow['kind'],
    cause: unknown,
  ) {
    super('outbox row failed', { cause });
    this.name = 'RowFailure';
  }
}

function retryDelayMs(attempts: number): number {
  return EMAIL_RETRY_BASE_DELAY_MS * (2 ** attempts - 1);
}

/** What a failure update did: the row's new attempt count, or nothing when no pending row matched. */
type FailureRecord = { attempts: number; permanent: boolean } | undefined;

/**
 * Delivers the PostgreSQL email outbox. Each row is handled in its own transaction holding the
 * row lock (`FOR UPDATE SKIP LOCKED`), so any number of workers can run without sending a row
 * twice (NFR-09). For token emails the token is issued inside that transaction, at send time, and
 * exists in plaintext only in this process's memory (threat R-05, user decision 2026-09-26 A).
 *
 * The retry schedule lives in the table (`next_attempt_at`), not in worker memory, so every worker
 * and every restart sees the same backoff and a row cannot burn its attempts in seconds.
 */
export class EmailWorker {
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private lastPurgeAt: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;
  private stopRequested = false;

  constructor(private readonly deps: EmailWorkerDependencies) {
    this.pollIntervalMs = deps.pollIntervalMs ?? EMAIL_POLL_INTERVAL_MS;
    this.batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  /**
   * One polling pass: runs the retention purge if due, then handles every due row once. A row that
   * fails for any reason is counted and logged, and the pass goes on with the next one.
   */
  async runOnce(): Promise<EmailWorkerRun> {
    await this.purgeIfDue();
    const run: EmailWorkerRun = { sent: 0, dropped: 0, failed: 0 };

    // A row handled in this pass is not picked again: it ends sent, deleted, failed for good, or
    // scheduled after now by its failure update.
    for (let i = 0; i < this.batchSize && !this.stopRequested; i += 1) {
      let outcome: RowOutcome;
      try {
        outcome = await this.handleNext();
      } catch (error) {
        if (!(error instanceof RowFailure)) throw error;
        await this.recordRowFailure(error);
        outcome = 'failed';
      }
      if (outcome === 'idle') break;
      run[outcome] += 1;
    }
    return run;
  }

  /** Polls every `pollIntervalMs` until `stop()`; a failed pass is logged and the next one runs. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.stopRequested = false;
    const tick = (): void => {
      this.running = this.runOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.deps.logger.error({ err: error }, 'email worker pass failed');
        })
        .finally(() => {
          if (!this.stopped) this.timer = setTimeout(tick, this.pollIntervalMs);
        });
    };
    tick();
  }

  /** Stops polling; the pass in progress finishes its current row and stops before the next. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.stopRequested = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private async purgeIfDue(): Promise<void> {
    const now = this.deps.clock.now().getTime();
    if (this.lastPurgeAt !== undefined && now - this.lastPurgeAt < PURGE_INTERVAL_MS) return;
    this.lastPurgeAt = now;
    // A failed purge must not stop delivery; it is retried at the next purge interval.
    try {
      const attempts = await this.deps.attemptPurger.purgeOlderThan(
        new Date(now - ATTEMPTS_RETENTION_MS),
      );
      const outboxRows = await this.purgeOutbox(new Date(now - OUTBOX_RETENTION_MS));
      this.deps.logger.debug({ attempts, outboxRows }, 'retention purge done');
    } catch (error) {
      this.deps.logger.error({ err: error }, 'retention purge failed');
    }
  }

  /** Deletes rows that are done (sent, or failed for good) and older than `cutoff`. */
  private async purgeOutbox(cutoff: Date): Promise<number> {
    const result = await this.deps.db
      .delete(emailOutbox)
      .where(
        and(
          or(isNotNull(emailOutbox.sentAt), gte(emailOutbox.attempts, EMAIL_MAX_ATTEMPTS)),
          lt(sql`coalesce(${emailOutbox.sentAt}, ${emailOutbox.createdAt})`, cutoff),
        ),
      );
    return result.rowCount ?? 0;
  }

  private handleNext(): Promise<RowOutcome> {
    const now = this.deps.clock.now();
    return this.deps.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(emailOutbox)
        .where(
          and(
            isNull(emailOutbox.sentAt),
            lt(emailOutbox.attempts, EMAIL_MAX_ATTEMPTS),
            or(isNull(emailOutbox.nextAttemptAt), lte(emailOutbox.nextAttemptAt, now)),
          ),
        )
        .orderBy(asc(emailOutbox.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return 'idle';
      try {
        return await this.handleRow(tx, row);
      } catch (error) {
        // Rethrown so this transaction rolls back; the attempt is counted in a separate one.
        throw new RowFailure(row.id, row.kind, error);
      }
    });
  }

  private async handleRow(tx: Transaction, row: OutboxRow): Promise<RowOutcome> {
    const log = { outboxId: row.id, kind: row.kind };
    const drop = async (reason: string): Promise<RowOutcome> => {
      await tx.delete(emailOutbox).where(eq(emailOutbox.id, row.id));
      this.deps.logger.debug({ ...log, reason }, 'outbox row dropped');
      return 'dropped';
    };

    if (row.kind === 'discard') return drop('discard');
    const userId = row.payload.userId;
    if (!userId || !row.toEmail) return drop('no recipient');
    const user = await new DrizzleUserRepository(tx).findById(userId);
    if (!user) return drop('user deleted');
    if (row.kind === 'verification' && user.emailVerifiedAt) return drop('already verified');
    // Requested before the password was last reset: that reset already answered it.
    if (
      row.kind === 'password_reset' &&
      user.passwordChangedAt &&
      row.createdAt < user.passwordChangedAt
    ) {
      return drop('superseded by a completed reset');
    }

    const kind = row.kind;
    const to = row.toEmail;
    const now = this.deps.clock.now();
    try {
      // Savepoint: if the transport fails, the token issued here is rolled back with it, while
      // the outer transaction keeps the row lock to count the attempt.
      const result = await tx.transaction(async (savepoint): Promise<SendResult> => {
        const token = await issueEmailToken(
          {
            oneTimeTokens: new DrizzleOneTimeTokenRepository(savepoint),
            tokenGenerator: this.deps.tokenGenerator,
            clock: this.deps.clock,
          },
          userId,
          PURPOSE_BY_KIND[kind],
        );
        const rendered = renderEmail({
          kind,
          language: row.language,
          token,
          webBaseUrl: this.deps.webBaseUrl,
        });
        let sent: SendResult;
        try {
          // One key per attempt: each attempt carries a new token (a different body), and a
          // provider rejects a reused key with a different payload (Resend: 409).
          const attempt = row.attempts + 1;
          sent = await this.deps.transport.send({
            idempotencyKey: `${row.id}:${attempt}`,
            to,
            ...rendered,
          });
        } catch (error) {
          throw new TransportFailure(error);
        }
        // The address is no longer needed once delivered (PII retention).
        await savepoint
          .update(emailOutbox)
          .set({ sentAt: now, attempts: row.attempts + 1, toEmail: null })
          .where(eq(emailOutbox.id, row.id));
        return sent;
      });
      this.deps.logger.info({ ...log, userId, messageId: result.messageId }, 'email sent');
      return 'sent';
    } catch (error) {
      if (!(error instanceof TransportFailure)) throw error;
      // The row lock is held here, so the update always matches; the guard matters for poison rows.
      const recorded = await this.recordFailure(tx, row.id);
      if (!recorded) {
        this.deps.logger.debug(log, 'outbox row already handled');
        return 'failed';
      }
      const details = { ...log, userId, attempts: recorded.attempts, err: error.cause };
      if (recorded.permanent) {
        this.deps.logger.error(details, 'email delivery failed permanently');
      } else {
        this.deps.logger.warn(details, 'email delivery failed; will retry');
      }
      return 'failed';
    }
  }

  /**
   * Counts one failed attempt and schedules the next one in a single statement, so `attempts` and
   * `next_attempt_at` never disagree. Only a still-pending row matches: one that another worker
   * sent (or dropped) in the meantime is left alone and nothing is scheduled.
   */
  private async recordFailure(db: IdentityDb, outboxId: string): Promise<FailureRecord> {
    const now = this.deps.clock.now().getTime();
    const nextAttempts = sql`${emailOutbox.attempts} + 1`;
    const schedule: SQL[] = [];
    for (let attempts = 1; attempts < EMAIL_MAX_ATTEMPTS; attempts += 1) {
      const at = new Date(now + retryDelayMs(attempts)).toISOString();
      schedule.push(sql`when ${attempts} then ${at}::timestamptz`);
    }
    const [updated] = await db
      .update(emailOutbox)
      .set({
        attempts: nextAttempts,
        // Null once failed for good; such a row is never picked again (attempts at the maximum).
        nextAttemptAt: sql`case ${nextAttempts} ${sql.join(schedule, sql` `)} else null end`,
        toEmail: sql`case when ${nextAttempts} >= ${EMAIL_MAX_ATTEMPTS} then null else ${emailOutbox.toEmail} end`,
      })
      .where(and(eq(emailOutbox.id, outboxId), isNull(emailOutbox.sentAt)))
      .returning({ attempts: emailOutbox.attempts });
    if (!updated) return undefined;
    return { attempts: updated.attempts, permanent: updated.attempts >= EMAIL_MAX_ATTEMPTS };
  }

  /** Counts the failed attempt of a row whose transaction rolled back, in a short transaction. */
  private async recordRowFailure(failure: RowFailure): Promise<void> {
    const log = { outboxId: failure.outboxId, kind: failure.kind };
    const recorded = await this.recordFailure(this.deps.db, failure.outboxId);
    if (!recorded) {
      // Another worker sent or dropped the row after this one rolled back: nothing to schedule.
      this.deps.logger.debug(log, 'outbox row already handled');
      return;
    }
    const details = { ...log, attempts: recorded.attempts, err: failure.cause };
    if (recorded.permanent) {
      this.deps.logger.error(details, 'outbox row failed permanently');
    } else {
      this.deps.logger.warn(details, 'outbox row failed');
    }
  }
}
