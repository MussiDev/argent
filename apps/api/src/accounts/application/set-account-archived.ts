import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { AccountWithBalance } from '../domain/account';
import { withSingleBalance } from './account-balances';
import type { AccountMovements } from './ports/account-movements';
import type { AccountRepository } from './ports/account-repository';

export interface SetAccountArchivedDependencies {
  accounts: AccountRepository;
  movements: AccountMovements;
}

export class SetAccountArchived {
  constructor(private readonly deps: SetAccountArchivedDependencies) {}

  /** Archives (`true`) or unarchives (`false`); repeating either is a no-op that returns the account. */
  async execute(
    scope: AccessScope<'write'>,
    id: string,
    archived: boolean,
  ): Promise<AccountWithBalance> {
    const account = notFoundUnlessAllowed(
      await this.deps.accounts.setArchived(scope, id, archived),
    );
    return withSingleBalance(this.deps.movements, account);
  }
}
