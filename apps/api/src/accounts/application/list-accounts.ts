import { AppError, type AccountCurrency, LIST_ACCOUNTS_MAX_LIMIT } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { AccountWithBalance } from '../domain/account';
import { balanceOf, totalsOf } from '../domain/account';
import { sumsFor, withBalance } from './account-balances';
import type { AccountMovements } from './ports/account-movements';
import type { AccountRepository, ListAccountsOptions } from './ports/account-repository';

export interface ListAccountsDependencies {
  accounts: AccountRepository;
  movements: AccountMovements;
}

export interface AccountList {
  items: AccountWithBalance[];
  /** Accounts matching the `archived` filter, across pages. */
  total: number;
  /** Balances of ALL active accounts included in the available total, per currency; zero when none. */
  availableTotals: Record<AccountCurrency, bigint>;
  /** Balances of ALL active accounts, credit cards included, per currency; zero when none. */
  netWorthTotals: Record<AccountCurrency, bigint>;
  /** Balances of ALL active credit cards per currency; zero when none. */
  debtTotals: Record<AccountCurrency, bigint>;
  /** Active credit cards across all pages. */
  creditCardCount: number;
}

export class ListAccounts {
  constructor(private readonly deps: ListAccountsDependencies) {}

  async execute(scope: AccessScope, options: ListAccountsOptions): Promise<AccountList> {
    const { limit, offset } = options;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > LIST_ACCOUNTS_MAX_LIMIT ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new AppError('VALIDATION_FAILED', 'limit or offset out of range');
    }

    const [page, active] = await Promise.all([
      this.deps.accounts.list(scope, options),
      this.deps.accounts.listActive(scope),
    ]);

    const ids = [...new Set([...page.items.map((a) => a.id), ...active.map((a) => a.id)])];
    const sums = await sumsFor(this.deps.movements, ids);

    const totals = totalsOf(
      active.map((account) => ({
        type: account.type,
        currency: account.currency,
        includeInAvailable: account.includeInAvailable,
        balance: balanceOf(account.openingBalance, sums.get(account.id) ?? 0n),
      })),
    );

    return {
      items: page.items.map((account) => withBalance(account, sums)),
      total: page.total,
      availableTotals: totals.available,
      netWorthTotals: totals.netWorth,
      debtTotals: totals.debt,
      creditCardCount: totals.creditCardCount,
    };
  }
}
