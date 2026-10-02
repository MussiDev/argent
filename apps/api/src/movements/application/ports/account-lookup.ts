import type { AccessScope } from '../../../shared/access';

export interface AccountReference {
  id: string;
  archived: boolean;
}

/** `null` when the account is missing or outside the scope. */
export interface AccountLookup {
  find(scope: AccessScope, id: string): Promise<AccountReference | null>;
}
