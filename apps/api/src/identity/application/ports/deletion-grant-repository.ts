/**
 * Proof that a password-less user re-authenticated with Google for deleting their account. Only
 * the hash of the token is stored; the grant is bound to the user, to the session family that
 * started the re-authentication and to the credentials version at that moment.
 */
export interface DeletionGrant {
  tokenHash: string;
  userId: string;
  sessionFamilyId: string;
  credentialsVersion: number;
  expiresAt: Date;
}

export interface DeletionGrantRepository {
  /** Deletes the user's previous grants and stores `grant`: one active grant per user, atomically. */
  replace(grant: DeletionGrant): Promise<void>;
  /** Reads the grant if every key matches and it has not expired at `now`; it is not consumed. */
  findLive(
    tokenHash: string,
    userId: string,
    sessionFamilyId: string,
    credentialsVersion: number,
    now: Date,
  ): Promise<DeletionGrant | null>;
}

/** Deletes grants nobody can use anymore; the email worker runs it periodically. */
export interface DeletionGrantPurger {
  /** Deletes grants expired at `now`; resolves how many were deleted. */
  purgeExpired(now: Date): Promise<number>;
}
