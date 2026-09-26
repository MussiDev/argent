import type { Clock } from '../../application/ports/clock';
import type { TransactionalRepositories, UnitOfWork } from '../../application/ports/unit-of-work';
import { OutboxEmailSender } from '../email/outbox-email-sender';
import { DrizzleOneTimeTokenRepository } from './drizzle-one-time-token-repository';
import { DrizzleSessionRepository } from './drizzle-session-repository';
import { DrizzleUserRepository } from './drizzle-user-repository';
import type { IdentityDb } from './schema';

/** One PostgreSQL transaction per `run`; the repositories handed to `work` are bound to it. */
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(
    private readonly db: IdentityDb,
    private readonly clock: Clock,
  ) {}

  run<T>(work: (repositories: TransactionalRepositories) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) =>
      work({
        users: new DrizzleUserRepository(tx),
        oneTimeTokens: new DrizzleOneTimeTokenRepository(tx),
        sessions: new DrizzleSessionRepository(tx),
        emailSender: new OutboxEmailSender(tx, this.clock),
      }),
    );
  }
}
