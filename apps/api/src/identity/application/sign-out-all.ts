import type { Clock } from './ports/clock';
import type { SessionRepository } from './ports/session-repository';

export interface SignOutAllDependencies {
  sessions: SessionRepository;
  clock: Clock;
}

/** AC-13: ends every session of the user, on every device. */
export class SignOutAll {
  constructor(private readonly deps: SignOutAllDependencies) {}

  async execute(userId: string): Promise<void> {
    await this.deps.sessions.revokeAllForUser(userId, this.deps.clock.now());
  }
}
