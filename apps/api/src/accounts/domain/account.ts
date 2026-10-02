import { addExact, type AccountCurrency, type AccountType } from '@pesly/shared';

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

/** Exact arbitrary-precision sum of two derived amounts; never throws (NFR-06). */
export function balanceOf(openingBalance: bigint, movementSum: bigint): bigint {
  return addExact(openingBalance, movementSum);
}
