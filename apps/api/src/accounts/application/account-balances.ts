import type { Account, AccountWithBalance } from '../domain/account';
import { balanceOf } from '../domain/account';
import type { AccountMovements } from './ports/account-movements';

/** Largest id list handed to the movements port in one call (NFR-02). */
export const MOVEMENTS_CHUNK_SIZE = 500;

/**
 * Movement sums for the given ids, in sequential chunks of at most 500. A port failure propagates:
 * no balance is ever guessed.
 */
export async function sumsFor(
  movements: AccountMovements,
  ids: readonly string[],
): Promise<Map<string, bigint>> {
  const sums = new Map<string, bigint>();
  for (let start = 0; start < ids.length; start += MOVEMENTS_CHUNK_SIZE) {
    const chunk = ids.slice(start, start + MOVEMENTS_CHUNK_SIZE);
    for (const [id, sum] of await movements.sumsByAccount(chunk)) sums.set(id, sum);
  }
  return sums;
}

export function withBalance(
  account: Account,
  sums: ReadonlyMap<string, bigint>,
): AccountWithBalance {
  return { ...account, balance: balanceOf(account.openingBalance, sums.get(account.id) ?? 0n) };
}

export async function withSingleBalance(
  movements: AccountMovements,
  account: Account,
): Promise<AccountWithBalance> {
  return withBalance(account, await sumsFor(movements, [account.id]));
}
