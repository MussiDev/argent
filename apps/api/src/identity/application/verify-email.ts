import { TokenInvalid } from '../domain/errors';
import type { Clock } from './ports/clock';
import type { TokenGenerator } from './ports/token-generator';
import type { UnitOfWork } from './ports/unit-of-work';

export interface VerifyEmailDependencies {
  tokenGenerator: TokenGenerator;
  clock: Clock;
  unitOfWork: UnitOfWork;
}

export class VerifyEmail {
  constructor(private readonly deps: VerifyEmailDependencies) {}

  /**
   * Consumes the unused, unexpired verification token and marks the email verified, atomically.
   * Rejects with `TokenInvalid` for an unknown, expired or used token (AC-06).
   */
  async execute(token: string): Promise<{ userId: string }> {
    const tokenHash = this.deps.tokenGenerator.hash(token);
    const now = this.deps.clock.now();
    return this.deps.unitOfWork.run(async ({ oneTimeTokens, users }) => {
      const consumed = await oneTimeTokens.consume(tokenHash, 'email_verification', now);
      if (!consumed) throw new TokenInvalid();
      await users.markEmailVerified(consumed.userId, now);
      return { userId: consumed.userId };
    });
  }
}
