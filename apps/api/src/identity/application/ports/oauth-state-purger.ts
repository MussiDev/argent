/** Deletes OAuth states nobody can complete anymore; the email worker runs it periodically. */
export interface OAuthStatePurger {
  /** Deletes states expired at `now`; resolves how many were deleted. */
  purgeExpired(now: Date): Promise<number>;
}
