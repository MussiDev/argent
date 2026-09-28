import { randomUUID } from 'node:crypto';
import type { Clock } from '../../application/ports/clock';
import type { EmailSender, OutboxEmail } from '../../application/ports/email-sender';
import { emailOutbox, type IdentityDb } from '../db/schema';

/**
 * `EmailSender` over the PostgreSQL outbox: the request path only inserts a row; the email worker
 * delivers it. The row never holds a token (R-05): the worker issues it at send time.
 */
export class OutboxEmailSender implements EmailSender {
  constructor(
    private readonly db: IdentityDb,
    private readonly clock: Clock,
  ) {}

  async enqueue(email: OutboxEmail): Promise<void> {
    await this.db.insert(emailOutbox).values({
      id: randomUUID(),
      kind: email.kind,
      toEmail: email.toEmail,
      language: email.language,
      payload: { userId: email.userId },
      // From the clock, not `now()`, so the worker's retry schedule and tests share one time base.
      createdAt: this.clock.now(),
    });
  }
}
