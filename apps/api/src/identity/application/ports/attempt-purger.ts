/** Deletes rate-limit windows nobody needs anymore; the email worker runs it periodically. */
export interface AttemptPurger {
  /** Deletes attempt windows that started before `cutoff`; resolves how many were deleted. */
  purgeOlderThan(cutoff: Date): Promise<number>;
}
