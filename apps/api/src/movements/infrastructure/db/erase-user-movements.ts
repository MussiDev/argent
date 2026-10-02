import { eq } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { movements } from './schema';

/**
 * A database handle or a transaction on it. Declared here, structurally, so the erasure
 * transaction of identity can be passed in without movements importing identity internals.
 */
export type EraseDatabase = PgDatabase<NodePgQueryResultHKT>;

/**
 * Deletes the user's movements. The composite keys from movements to accounts and categories
 * restrict, so they must go before the user's accounts and categories do (the cascade from `users`
 * does not guarantee an order). Registered by the composition root as an ordered erasure step;
 * `movement_rate_limits` cascades from `users` and needs no step.
 */
export async function eraseUserMovements(tx: EraseDatabase, userId: string): Promise<void> {
  await tx.delete(movements).where(eq(movements.ownerId, userId));
}
