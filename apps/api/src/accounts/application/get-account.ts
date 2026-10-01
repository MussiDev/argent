import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { AccountWithBalance } from '../domain/account';
import { withSingleBalance } from './account-balances';
import type { AccountMovements } from './ports/account-movements';
import type { AccountRepository } from './ports/account-repository';

export interface GetAccountDependencies {
  accounts: AccountRepository;
  movements: AccountMovements;
}

export class GetAccount {
  constructor(private readonly deps: GetAccountDependencies) {}

  /** Archived accounts stay readable by id. */
  async execute(scope: AccessScope, id: string): Promise<AccountWithBalance> {
    const account = notFoundUnlessAllowed(await this.deps.accounts.findById(scope, id));
    return withSingleBalance(this.deps.movements, account);
  }
}
