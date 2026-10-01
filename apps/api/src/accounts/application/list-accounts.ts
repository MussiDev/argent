import {
  AppError,
  sumMinorUnits,
  type AccountCurrency,
  LIST_ACCOUNTS_MAX_LIMIT,
} from '@argent/shared';
import type { AccessScope } from '../../shared/access';
import type { AccountWithBalance } from '../domain/account';
import { balanceOf } from '../domain/account';
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
  /** Sum of the balances of ALL active accounts per currency; zero when there are none. */
  totals: Record<AccountCurrency, bigint>;
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

    const balances: Record<AccountCurrency, bigint[]> = { ARS: [], USD: [] };
    for (const account of active) {
      balances[account.currency].push(
        balanceOf(account.openingBalance, sums.get(account.id) ?? 0n),
      );
    }

    return {
      items: page.items.map((account) => withBalance(account, sums)),
      total: page.total,
      totals: { ARS: sumMinorUnits(balances.ARS), USD: sumMinorUnits(balances.USD) },
    };
  }
}
