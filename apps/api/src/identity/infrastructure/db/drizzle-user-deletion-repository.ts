import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type {
  EraseUserInput,
  EraseUserResult,
  UserDeletionRepository,
} from '../../application/ports/user-deletion-repository';
import { deletionGrants, emailOutbox, users, type IdentityDb } from './schema';
import type { UserErasureStep } from './user-erasure-step';

/** Thrown inside the transaction to roll everything back and carry the reason out of it. */
class ErasureAborted extends Error {
  constructor(readonly result: Exclude<EraseUserResult, 'erased'>) {
    super(`erasure aborted: ${result}`);
    this.name = 'ErasureAborted';
  }
}

export class DrizzleUserDeletionRepository implements UserDeletionRepository {
  constructor(
    private readonly db: IdentityDb,
    private readonly steps: readonly UserErasureStep[] = [],
  ) {}

  /**
   * One transaction that locks in the order the email worker already does (outbox row first, user
   * second), so the two cannot deadlock.
   */
  async erase({ userId, credentialsVersion, grant }: EraseUserInput): Promise<EraseUserResult> {
    try {
      await this.db.transaction(async (tx) => {
        // Bounds every wait below: a stuck lock aborts the deletion instead of holding a
        // connection. Raw SQL because the query builder has no `set local`.
        await tx.execute(sql`set local lock_timeout = '5s'`);

        // No lock here: the user row is locked explicitly below, after the outbox rows.
        const [user] = await tx
          .select({ email: users.email })
          .from(users)
          .where(and(eq(users.id, userId), eq(users.credentialsVersion, credentialsVersion)))
          .limit(1);
        if (!user) throw new ErasureAborted('stale');

        // The outbox has no foreign key to users and its recipient address is personal data, so
        // its rows go by user id and by address. `skip locked` leaves the row a worker is sending
        // right now; the worker drops it on its next pass because the user is gone.
        await tx.delete(emailOutbox).where(
          inArray(
            emailOutbox.id,
            tx
              .select({ id: emailOutbox.id })
              .from(emailOutbox)
              .where(
                or(
                  // Raw: drizzle has no jsonb text-extract helper; the user id is a bound parameter.
                  sql`${emailOutbox.payload}->>'userId' = ${userId}`,
                  eq(emailOutbox.toEmail, user.email),
                ),
              )
              .for('update', { skipLocked: true }),
          ),
        );

        if (grant) {
          const consumed = await tx
            .delete(deletionGrants)
            .where(
              and(
                eq(deletionGrants.tokenHash, grant.tokenHash),
                eq(deletionGrants.userId, userId),
                eq(deletionGrants.sessionFamilyId, grant.sessionFamilyId),
                eq(deletionGrants.credentialsVersion, credentialsVersion),
                gt(deletionGrants.expiresAt, grant.now),
              ),
            )
            .returning({ tokenHash: deletionGrants.tokenHash });
          if (consumed.length === 0) throw new ErasureAborted('grant_invalid');
        }

        // Locks the user row (outbox first, user second, the order the email worker uses). A
        // movement insert in flight holds a key-share lock on it, so this waits for that insert and
        // the steps below see it; one that starts later waits here and fails on the foreign key.
        // This relies on the 0014 key to users being created before the account and category keys
        // (referential triggers fire in creation order): an insert then waits here holding nothing.
        await tx.execute(sql`select id from users where id = ${userId} for update`);

        for (const step of this.steps) await step(tx, userId);

        // The foreign keys with `on delete cascade` remove everything else the user owns.
        const erased = await tx
          .delete(users)
          .where(and(eq(users.id, userId), eq(users.credentialsVersion, credentialsVersion)))
          .returning({ id: users.id });
        if (erased.length === 0) throw new ErasureAborted('stale');
      });
    } catch (error) {
      if (error instanceof ErasureAborted) return error.result;
      throw error;
    }
    return 'erased';
  }
}
