import type { AccountCurrency, AccountType } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';
import type { Account } from '../../domain/account';

export interface CreateAccountData {
  name: string;
  type: AccountType;
  currency: AccountCurrency;
  openingBalance: bigint;
}

export interface ActiveAccount {
  id: string;
  currency: AccountCurrency;
  openingBalance: bigint;
}

export interface ListAccountsOptions {
  archived: boolean;
  limit: number;
  offset: number;
}

/**
 * Every method takes the scope first; a row outside it is indistinguishable from a missing one
 * (`null` / `false`). Name conflicts (case-insensitive, per owner) raise `AccountNameTaken`; a
 * foreign-key violation on delete raises `AccountHasMovements`.
 */
export interface AccountRepository {
  /** The owner is the scope's user. */
  create(scope: AccessScope<'write'>, data: CreateAccountData): Promise<Account>;
  findById(scope: AccessScope, id: string): Promise<Account | null>;
  list(
    scope: AccessScope,
    options: ListAccountsOptions,
  ): Promise<{ items: Account[]; total: number }>;
  /** Every non-archived account in scope, for the per-currency totals. */
  listActive(scope: AccessScope): Promise<ActiveAccount[]>;
  rename(scope: AccessScope<'write'>, id: string, name: string): Promise<Account | null>;
  /** Idempotent: setting the state an account already has returns it unchanged. */
  setArchived(scope: AccessScope<'write'>, id: string, archived: boolean): Promise<Account | null>;
  /** `false` when nothing in scope matched. */
  delete(scope: AccessScope<'write'>, id: string): Promise<boolean>;
}
