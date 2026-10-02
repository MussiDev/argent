import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import { AccountHasMovements } from '../domain/errors';
import type { AccountMovements } from './ports/account-movements';
import type { AccountRepository } from './ports/account-repository';

export interface DeleteAccountDependencies {
  accounts: AccountRepository;
  movements: AccountMovements;
}

export class DeleteAccount {
  constructor(private readonly deps: DeleteAccountDependencies) {}

  /**
   * Missing or foreign: `ResourceNotFound`. With movements: `AccountHasMovements`, row kept. A
   * foreign-key violation raised by the repository (a movement created in between) propagates as
   * the same error.
   */
  async execute(scope: AccessScope<'write'>, id: string): Promise<void> {
    notFoundUnlessAllowed(await this.deps.accounts.findById(scope, id));
    if (await this.deps.movements.hasMovements(id)) throw new AccountHasMovements();
    const deleted = await this.deps.accounts.delete(scope, id);
    if (!deleted) throw new ResourceNotFound();
  }
}
