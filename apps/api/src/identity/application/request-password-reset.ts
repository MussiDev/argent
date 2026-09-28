import { DEFAULT_LANGUAGE } from '../domain/account-defaults';
import { Email } from '../domain/email';
import { RateLimited } from '../domain/errors';
import { UNKNOWN_IP } from './client-ip';
import type { AttemptLimiter, AttemptPolicy } from './ports/attempt-limiter';
import type { EmailSender } from './ports/email-sender';
import type { UserRepository } from './ports/user-repository';

const HOUR_SECONDS = 60 * 60;

/** Threat R-09: 5 reset requests per client IP per hour, like registrations. */
export const RESET_IP_POLICY: AttemptPolicy = {
  kind: 'reset_ip',
  limit: 5,
  windowSeconds: HOUR_SECONDS,
};

/** Threat R-09: 5 reset requests per normalized email per hour, so a victim cannot be email-bombed. */
export const RESET_EMAIL_POLICY: AttemptPolicy = {
  kind: 'reset_email',
  limit: 5,
  windowSeconds: HOUR_SECONDS,
};

export interface RequestPasswordResetDependencies {
  attemptLimiter: AttemptLimiter;
  users: UserRepository;
  emailSender: EmailSender;
}

export interface RequestPasswordResetInput {
  email: string;
  ip: string | undefined;
}

/** For logging only: the HTTP response is the same for both outcomes (anti-enumeration, R-02). */
export type RequestPasswordResetResult =
  { outcome: 'enqueued'; userId: string } | { outcome: 'discarded' };

export class RequestPasswordReset {
  constructor(private readonly deps: RequestPasswordResetDependencies) {}

  async execute(input: RequestPasswordResetInput): Promise<RequestPasswordResetResult> {
    const email = Email.parse(input.email);

    // Recorded before anything else and atomically, so registered and unknown emails count the
    // same and concurrent requests cannot slip past the limit. A refused IP does not also fill
    // the email's bucket, which would lock the real owner out of resetting.
    const address = await this.deps.attemptLimiter.record(RESET_IP_POLICY, input.ip ?? UNKNOWN_IP);
    if (!address.allowed) throw new RateLimited();
    const account = await this.deps.attemptLimiter.record(RESET_EMAIL_POLICY, email.value);
    if (!account.allowed) throw new RateLimited();

    // One lookup and one outbox insert on every path, so the work done is the same (NFR-08).
    const user = await this.deps.users.findByEmail(email);
    if (!user?.emailVerifiedAt) {
      await this.deps.emailSender.enqueue({
        kind: 'discard',
        userId: null,
        toEmail: null,
        language: DEFAULT_LANGUAGE,
      });
      return { outcome: 'discarded' };
    }

    // No token here: the worker issues the 60-minute token when it sends the email (R-05).
    await this.deps.emailSender.enqueue({
      kind: 'password_reset',
      userId: user.id,
      toEmail: user.email,
      language: user.language,
    });
    return { outcome: 'enqueued', userId: user.id };
  }
}
