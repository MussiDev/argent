import { defaultIncludeInAvailable } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { AccountWithBalance } from '../domain/account';
import type { AccountRepository, CreateAccountData } from './ports/account-repository';

export interface CreateAccountDependencies {
  accounts: AccountRepository;
}

export class CreateAccount {
  constructor(private readonly deps: CreateAccountDependencies) {}

  /** `data` is already parsed; an omitted opening balance arrived as `0n`. A new account has no movements. */
  async execute(scope: AccessScope<'write'>, data: CreateAccountData): Promise<AccountWithBalance> {
    const includeInAvailable =
      data.type === 'credit_card'
        ? false
        : (data.includeInAvailable ?? defaultIncludeInAvailable(data.type));
    const account = await this.deps.accounts.create(scope, { ...data, includeInAvailable });
    return { ...account, balance: account.openingBalance };
  }
}
