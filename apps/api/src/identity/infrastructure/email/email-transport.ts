import { Resend } from 'resend';
import type { Env } from '../../../shared/config/env';
import type { Logger } from '../../../shared/logging/logger';
import { ConsoleTransport } from './transports/console-transport';
import { MailpitTransport } from './transports/mailpit-transport';
import { ResendTransport } from './transports/resend-transport';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  /** The provider's id for the message, logged per send (repudiation control). */
  messageId: string | undefined;
}

/** Delivers one rendered email; rejects when the provider did not accept it. */
export interface EmailTransport {
  send(message: EmailMessage): Promise<SendResult>;
}

/**
 * The transport named by `EMAIL_PROVIDER`: `console` for development, `mailpit` (SMTP) for local
 * and e2e runs, `resend` in production. Tests use their own capturing transport and never Resend.
 */
export function createEmailTransport(
  env: Pick<Env, 'EMAIL_PROVIDER' | 'RESEND_API_KEY' | 'EMAIL_FROM'>,
  logger: Logger,
): EmailTransport {
  switch (env.EMAIL_PROVIDER) {
    case 'console':
      logger.warn('EMAIL_PROVIDER=console: emails, links included, are printed to stdout');
      return new ConsoleTransport();
    case 'mailpit':
      return new MailpitTransport({ from: env.EMAIL_FROM });
    case 'resend':
      if (!env.RESEND_API_KEY)
        throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
      return new ResendTransport({ client: new Resend(env.RESEND_API_KEY), from: env.EMAIL_FROM });
  }
}
