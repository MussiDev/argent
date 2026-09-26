import type {
  EmailMessage,
  EmailTransport,
  SendResult,
} from '../../src/identity/infrastructure/email/email-transport';

const TOKEN_IN_LINK = /https?:\/\/[^\s"<>]+[?&]token=([A-Za-z0-9_-]{43})/;

export interface CapturedEmail extends EmailMessage {
  /** The first link carrying a token, as written in the plain-text body. */
  link: string | undefined;
  /** The token read from that link; tests never read tokens from the database. */
  token: string | undefined;
}

/**
 * Test transport: records every delivered email and the link it carries. It can be told to fail
 * or to be slow, to exercise retries and concurrent workers.
 */
export class CapturingTransport implements EmailTransport {
  readonly sent: CapturedEmail[] = [];
  /** Every call to `send`, successful or not. */
  attempts = 0;
  delayMs = 0;
  private failuresLeft = 0;

  failNext(times: number): void {
    this.failuresLeft = times;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    this.attempts += 1;
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error('provider unavailable');
    }
    const match = TOKEN_IN_LINK.exec(message.text);
    this.sent.push({ ...message, link: match?.[0], token: match?.[1] });
    return { messageId: `captured-${this.sent.length}` };
  }

  sentTo(email: string): CapturedEmail[] {
    return this.sent.filter((captured) => captured.to === email);
  }

  /** Token of the most recent email sent to `email`; fails the test if there is none. */
  lastTokenFor(email: string): string {
    const token = this.sentTo(email).at(-1)?.token;
    if (!token) throw new Error(`No email with a token was sent to ${email}`);
    return token;
  }
}
