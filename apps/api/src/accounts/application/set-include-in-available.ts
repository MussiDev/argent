import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { AccountWithBalance } from '../domain/account';
import { AccountArchived, CreditCardSettingLocked } from '../domain/errors';
import { withSingleBalance } from './account-balances';
import type { AccountMovements } from './ports/account-movements';
import type { AccountRepository } from './ports/account-repository';

export interface SetIncludeInAvailableDependencies {
  accounts: AccountRepository;
  movements: AccountMovements;
}

export class SetIncludeInAvailable {
  constructor(private readonly deps: SetIncludeInAvailableDependencies) {}

  /** A credit card is refused first (even archived), then an archived account; repeating a value is a no-op. */
  async execute(
    scope: AccessScope<'write'>,
    id: string,
    value: boolean,
  ): Promise<AccountWithBalance> {
    const result = await this.deps.accounts.setIncludeInAvailable(scope, id, value);
    switch (result.status) {
      case 'not_found':
        return notFoundUnlessAllowed<AccountWithBalance>(null);
      case 'credit_card':
        throw new CreditCardSettingLocked();
      case 'archived':
        throw new AccountArchived();
      case 'updated':
        return withSingleBalance(this.deps.movements, result.account);
    }
  }
}
