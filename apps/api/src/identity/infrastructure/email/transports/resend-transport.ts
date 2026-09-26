import type { EmailMessage, EmailTransport, SendResult } from '../email-transport';

/** Deadline for one Resend API call; the worker holds the outbox row lock while it waits. */
export const RESEND_TIMEOUT_MS = 10_000;

interface ResendSendPayload {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

interface ResendSendResponse {
  data: { id: string } | null;
  error: { name: string; message: string; statusCode?: number | null } | null;
}

/** The slice of the Resend SDK client this transport uses; tests pass a fake, never the real one. */
export interface ResendClient {
  emails: { send(payload: ResendSendPayload): Promise<ResendSendResponse> };
}

export interface ResendTransportOptions {
  client: ResendClient;
  from: string;
  timeoutMs?: number;
}

/**
 * Production transport over the Resend API (send-only key from the environment).
 *
 * A call that does not answer within `timeoutMs` is abandoned and reported as a failure, so a hung
 * request cannot keep the worker (and the outbox row lock) stuck. The abandoned request may still
 * be delivered afterwards: the user then gets a duplicate email whose link is already invalid,
 * because the token it carries was rolled back with the failed attempt and the retry issues a new
 * one.
 */
export class ResendTransport implements EmailTransport {
  private readonly timeoutMs: number;

  constructor(private readonly options: ResendTransportOptions) {
    this.timeoutMs = options.timeoutMs ?? RESEND_TIMEOUT_MS;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Resend request timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
    });
    try {
      const { data, error } = await Promise.race([
        this.options.client.emails.send({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        deadline,
      ]);
      // The SDK reports API errors in the result instead of rejecting. Its message can echo the
      // recipient address, so only the error name and status are kept (errors end up in logs).
      if (error) {
        throw new Error(
          `Resend rejected the email: ${error.name} (status ${error.statusCode ?? 'unknown'})`,
        );
      }
      return { messageId: data?.id };
    } finally {
      clearTimeout(timer);
    }
  }
}
