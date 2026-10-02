import type { IdentityDb } from './schema';

/**
 * Runs inside the transaction that creates a user, with that transaction's handle. Registered by
 * the composition root so other modules can provision a new account without identity importing them.
 */
export type UserCreatedHook = (tx: IdentityDb, userId: string) => Promise<void>;
