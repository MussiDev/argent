import {
  formatMinorUnitsString,
  type AccountCurrency,
  type AccountResponse,
  type ListAccountsResponse,
} from '@pesly/shared';
import type { AccountList } from '../../application/list-accounts';
import type { AccountWithBalance } from '../../domain/account';

/** The only place where `bigint` amounts become decimal strings and dates become ISO strings. */
export function presentAccount(account: AccountWithBalance): AccountResponse {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    // Plain bigint toString, no int64 check: derived balance and totals are exact.
    openingBalance: formatMinorUnitsString(account.openingBalance),
    balance: formatMinorUnitsString(account.balance),
    includeInAvailable: account.includeInAvailable,
    archived: account.archivedAt !== null,
    archivedAt: account.archivedAt?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
  };
}

function presentTotals(totals: Record<AccountCurrency, bigint>): Record<AccountCurrency, string> {
  return {
    ARS: formatMinorUnitsString(totals.ARS),
    USD: formatMinorUnitsString(totals.USD),
  };
}

export function presentAccountList(
  list: AccountList,
  page: { limit: number; offset: number },
): ListAccountsResponse {
  return {
    items: list.items.map(presentAccount),
    availableTotals: presentTotals(list.availableTotals),
    netWorthTotals: presentTotals(list.netWorthTotals),
    debtTotals: presentTotals(list.debtTotals),
    creditCardCount: list.creditCardCount,
    total: list.total,
    limit: page.limit,
    offset: page.offset,
  };
}
