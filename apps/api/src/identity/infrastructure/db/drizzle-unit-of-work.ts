import type { Clock } from '../../application/ports/clock';
import type { TransactionalRepositories, UnitOfWork } from '../../application/ports/unit-of-work';
import { OutboxEmailSender } from '../email/outbox-email-sender';
import { DrizzleOneTimeTokenRepository } from './drizzle-one-time-token-repository';
import { DrizzleRecoveryCodeRepository } from './drizzle-recovery-code-repository';
import { DrizzleSessionRepository } from './drizzle-session-repository';
import { DrizzleSignInChallengeRepository } from './drizzle-sign-in-challenge-repository';
import { DrizzleTwoFactorRepository } from './drizzle-two-factor-repository';
import { DrizzleUserIdentityRepository } from './drizzle-user-identity-repository';
import { DrizzleUserRepository } from './drizzle-user-repository';
import { NewUserProvisioningFailed } from './new-user-provisioning-failed';
import type { IdentityDb } from './schema';
import type { UserCreatedHook } from './user-created-hook';

/** One PostgreSQL transaction per `run`; the repositories handed to `work` are bound to it. */
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(
    private readonly db: IdentityDb,
    private readonly clock: Clock,
    private readonly onUserCreated: readonly UserCreatedHook[] = [],
  ) {}

  run<T>(work: (repositories: TransactionalRepositories) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) =>
      work({
        users: new DrizzleUserRepository(tx),
        oneTimeTokens: new DrizzleOneTimeTokenRepository(tx),
        sessions: new DrizzleSessionRepository(tx),
        identities: new DrizzleUserIdentityRepository(tx),
        emailSender: new OutboxEmailSender(tx, this.clock),
        twoFactor: new DrizzleTwoFactorRepository(tx),
        recoveryCodes: new DrizzleRecoveryCodeRepository(tx),
        signInChallenges: new DrizzleSignInChallengeRepository(tx),
        provisioning: {
          provision: async (userId) => {
            // In order and one at a time: they share one connection, and a failure stops the rest.
            for (const hook of this.onUserCreated) {
              try {
                await hook(tx, userId);
              } catch (error) {
                throw new NewUserProvisioningFailed(error);
              }
            }
          },
        },
      }),
    );
  }
}
