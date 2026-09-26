import { randomUUID } from 'node:crypto';
import type { EmailMessage, EmailTransport, SendResult } from '../email-transport';

export interface ConsoleTransportOptions {
  /** Defaults to stdout. */
  write?: (chunk: string) => void;
}

/**
 * Development transport: prints the subject and body so links can be opened by hand. The
 * recipient address is left out (emails are PII and never go to logs). Production refuses it.
 */
export class ConsoleTransport implements EmailTransport {
  private readonly write: (chunk: string) => void;

  constructor(options: ConsoleTransportOptions = {}) {
    this.write =
      options.write ??
      ((chunk) => {
        process.stdout.write(chunk);
      });
  }

  send(message: EmailMessage): Promise<SendResult> {
    const messageId = `console-${randomUUID()}`;
    this.write(
      `\n--- email ${messageId} ---\nSubject: ${message.subject}\n\n${message.text}\n---\n`,
    );
    return Promise.resolve({ messageId });
  }
}
