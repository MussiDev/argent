/** The grant that authorizes a deletion without a password; consumed by the same transaction. */
export interface ErasureGrant {
  tokenHash: string;
  sessionFamilyId: string;
  now: Date;
}

export interface EraseUserInput {
  userId: string;
  /** The version the caller authenticated against; a password change in between makes it stale. */
  credentialsVersion: number;
  grant?: ErasureGrant;
}

/**
 * `erased`: the user and everything that cascades from it are gone. `grant_invalid`: the grant is
 * unknown, expired, used or bound to something else; nothing changed. `stale`: the user does not
 * exist or its credentials version moved on; nothing changed.
 */
export type EraseUserResult = 'erased' | 'grant_invalid' | 'stale';

export interface UserDeletionRepository {
  /** One transaction, owned by the adapter, that also consumes the grant when one is given. */
  erase(input: EraseUserInput): Promise<EraseUserResult>;
}
