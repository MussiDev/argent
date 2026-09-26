import type { EmailSender, OutboxEmail } from '../../src/identity/application/ports/email-sender';

/** Captures enqueued emails in unit tests; nothing is delivered. */
export class InMemoryEmailSender implements EmailSender {
  readonly enqueued: OutboxEmail[] = [];

  enqueue(email: OutboxEmail): Promise<void> {
    this.enqueued.push(email);
    return Promise.resolve();
  }
}
