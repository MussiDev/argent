import { addMinorUnits, type AccountCurrency, type AccountType } from '@argent/shared';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: AccountCurrency;
  /** Signed minor units; may be negative. */
  openingBalance: bigint;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface AccountWithBalance extends Account {
  /** `openingBalance` plus the sum of the account's movements, computed on read. */
  balance: bigint;
}

/** Throws `RangeError` when the result leaves the signed 64-bit range. */
export function balanceOf(openingBalance: bigint, movementSum: bigint): bigint {
  return addMinorUnits(openingBalance, movementSum);
}
