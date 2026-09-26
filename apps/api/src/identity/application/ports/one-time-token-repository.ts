export const ONE_TIME_TOKEN_PURPOSES = ['email_verification', 'password_reset'] as const;
export type OneTimeTokenPurpose = (typeof ONE_TIME_TOKEN_PURPOSES)[number];

export interface NewOneTimeToken {
  userId: string;
  purpose: OneTimeTokenPurpose;
  /** SHA-256 of the token; the token itself is never stored (threat R-05). */
  tokenHash: string;
  expiresAt: Date;
}

export interface ConsumedOneTimeToken {
  id: string;
  userId: string;
}

export interface OneTimeTokenRepository {
  create(token: NewOneTimeToken): Promise<void>;
  /**
   * Atomically marks as used the unused, unexpired token with this hash and purpose, and returns
   * its owner; resolves null when there is none (unknown, expired, used or other purpose).
   */
  consume(
    tokenHash: string,
    purpose: OneTimeTokenPurpose,
    now: Date,
  ): Promise<ConsumedOneTimeToken | null>;
  /**
   * Serializes token issue for one user and purpose until the current transaction ends, so two
   * concurrent issuers cannot each leave a valid token behind. Must run inside a transaction.
   */
  lockIssuance(userId: string, purpose: OneTimeTokenPurpose): Promise<void>;
  /** Marks every still-unused token of the user and purpose as used. */
  invalidateUnused(userId: string, purpose: OneTimeTokenPurpose, now: Date): Promise<void>;
}
