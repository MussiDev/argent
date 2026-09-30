/** Deletes sign-in challenges nobody can complete anymore; the email worker runs it periodically. */
export interface SignInChallengePurger {
  /** Deletes challenges expired at `now`; resolves how many were deleted. */
  purgeExpired(now: Date): Promise<number>;
}
