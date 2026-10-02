import type { IdentityDb } from './schema';

/**
 * Runs inside the transaction that erases a user, in order, after the outbox delete and the grant
 * check and before the `users` row is deleted. The composition root registers the steps so other
 * modules can remove rows whose keys restrict, without identity importing them. A rejection rolls
 * the whole erasure back.
 */
export type UserErasureStep = (tx: IdentityDb, userId: string) => Promise<void>;
