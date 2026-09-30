import type { EmailSender } from './email-sender';
import type { OneTimeTokenRepository } from './one-time-token-repository';
import type { RecoveryCodeRepository } from './recovery-code-repository';
import type { SessionRepository } from './session-repository';
import type { SignInChallengeRepository } from './sign-in-challenge-repository';
import type { TwoFactorRepository } from './two-factor-repository';
import type { UserIdentityRepository } from './user-identity-repository';
import type { UserRepository } from './user-repository';

/** Repositories bound to one transaction. */
export interface TransactionalRepositories {
  users: UserRepository;
  oneTimeTokens: OneTimeTokenRepository;
  sessions: SessionRepository;
  identities: UserIdentityRepository;
  emailSender: EmailSender;
  twoFactor: TwoFactorRepository;
  recoveryCodes: RecoveryCodeRepository;
  signInChallenges: SignInChallengeRepository;
}

/**
 * Runs `work` atomically: every write through the given repositories commits together, or none
 * does if `work` rejects.
 */
export interface UnitOfWork {
  run<T>(work: (repositories: TransactionalRepositories) => Promise<T>): Promise<T>;
}
