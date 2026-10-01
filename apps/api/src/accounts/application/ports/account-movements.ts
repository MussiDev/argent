/**
 * The only door through which movements reach accounts (PRD 03 implements it).
 *
 * UNSCOPED BY DESIGN: it takes no `AccessScope`. It is safe only because the accounts module
 * passes it ids the scoped `AccountRepository` just returned. An adapter must key every result by
 * the ids it was given and must never read other accounts' rows.
 */
export interface AccountMovements {
  /** Signed minor units per account; an id absent from the map means zero. */
  sumsByAccount(accountIds: readonly string[]): Promise<ReadonlyMap<string, bigint>>;
  hasMovements(accountId: string): Promise<boolean>;
}
