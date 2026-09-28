import { RateLimited, Unauthenticated } from '../domain/errors';
import type { AttemptLimiter, AttemptPolicy } from './ports/attempt-limiter';
import type { EmailSender } from './ports/email-sender';
import type { UserRepository } from './ports/user-repository';

/** Threat R-09: 3 verification resends per account per hour, so a victim cannot be email-bombed. */
export const RESEND_ACCOUNT_POLICY: AttemptPolicy = {
  kind: 'resend_account',
  limit: 3,
  windowSeconds: 60 * 60,
};

export interface ResendVerificationDependencies {
  attemptLimiter: AttemptLimiter;
  users: UserRepository;
  emailSender: EmailSender;
}

export type ResendVerificationResult = { outcome: 'enqueued' } | { outcome: 'already_verified' };

export class ResendVerification {
  constructor(private readonly deps: ResendVerificationDependencies) {}

  /**
   * Queues a new verification email for the signed-in user. The worker invalidates the previous
   * links when it issues the new token, at send time.
   */
  async execute(userId: string): Promise<ResendVerificationResult> {
    // Recorded first and atomically, so concurrent resends cannot exceed the limit.
    const attempt = await this.deps.attemptLimiter.record(RESEND_ACCOUNT_POLICY, userId);
    if (!attempt.allowed) throw new RateLimited();

    const user = await this.deps.users.findById(userId);
    if (!user) throw new Unauthenticated();
    if (user.emailVerifiedAt) return { outcome: 'already_verified' };

    await this.deps.emailSender.enqueue({
      kind: 'verification',
      userId: user.id,
      toEmail: user.email,
      language: user.language,
    });
    return { outcome: 'enqueued' };
  }
}
