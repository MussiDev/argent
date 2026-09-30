import type { EmailSender } from './email-sender';
import type { OneTimeTokenRepository } from './one-time-token-repository';
import type { SessionRepository } from './session-repository';
import type { UserIdentityRepository } from './user-identity-repository';
import type { UserRepository } from './user-repository';

/** Repositories bound to one transaction. */
export interface TransactionalRepositories {
  users: UserRepository;
  oneTimeTokens: OneTimeTokenRepository;
  sessions: SessionRepository;
  identities: UserIdentityRepository;
  emailSender: EmailSender;
}

/**
 * Runs `work` atomically: every write through the given repositories commits together, or none
 * does if `work` rejects.
 */
export interface UnitOfWork {
  run<T>(work: (repositories: TransactionalRepositories) => Promise<T>): Promise<T>;
}
