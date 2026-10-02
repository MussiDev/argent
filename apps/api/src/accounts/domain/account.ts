import { addExact, sumExact, type AccountCurrency, type AccountType } from '@pesly/shared';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: AccountCurrency;
  /** Signed minor units; may be negative. */
  openingBalance: bigint;
  /** Whether the balance counts toward the available total; always false for a credit card. */
  includeInAvailable: boolean;
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

export interface BalanceEntry {
  type: AccountType;
  currency: AccountCurrency;
  includeInAvailable: boolean;
  balance: bigint;
}

export interface AccountTotals {
  /** Balances of the accounts included in the available total. */
  available: Record<AccountCurrency, bigint>;
  /** Balances of every account, credit cards included. */
  netWorth: Record<AccountCurrency, bigint>;
  /** Balances of the credit card accounts. */
  debt: Record<AccountCurrency, bigint>;
  creditCardCount: number;
}

/** Per-currency totals over active accounts; a currency with no account totals zero. */
export function totalsOf(entries: readonly BalanceEntry[]): AccountTotals {
  const totalFor = (keep: (entry: BalanceEntry) => boolean): Record<AccountCurrency, bigint> => {
    const picked = entries.filter(keep);
    const of = (currency: AccountCurrency): bigint =>
      sumExact(picked.filter((e) => e.currency === currency).map((e) => e.balance));
    return { ARS: of('ARS'), USD: of('USD') };
  };
  return {
    available: totalFor((e) => e.includeInAvailable),
    netWorth: totalFor(() => true),
    debt: totalFor((e) => e.type === 'credit_card'),
    creditCardCount: entries.filter((e) => e.type === 'credit_card').length,
  };
}
