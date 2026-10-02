/**
 * Creates whatever a new account needs to exist from its first request (e.g. its default
 * categories). Bound to the transaction that creates the user, so the account and its provisioning
 * commit together or not at all; a rejection rolls the creation back.
 */
export interface NewUserProvisioning {
  provision(userId: string): Promise<void>;
}
