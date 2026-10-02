import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { AccountWithBalance } from '../domain/account';
import { withSingleBalance } from './account-balances';
import type { AccountMovements } from './ports/account-movements';
import type { AccountRepository } from './ports/account-repository';

export interface RenameAccountDependencies {
  accounts: AccountRepository;
  movements: AccountMovements;
}

export class RenameAccount {
  constructor(private readonly deps: RenameAccountDependencies) {}

  /** Raises `AccountNameTaken` (from the repository) on a case-insensitive duplicate. */
  async execute(
    scope: AccessScope<'write'>,
    id: string,
    name: string,
  ): Promise<AccountWithBalance> {
    const account = notFoundUnlessAllowed(await this.deps.accounts.rename(scope, id, name));
    return withSingleBalance(this.deps.movements, account);
  }
}
