import { ACCOUNT_NAME_MAX_LENGTH } from '@argent/shared';
import type { ErrorMessageKey } from '@/features/auth/form-errors';

export type AccountFieldName = 'name' | 'type' | 'currency' | 'openingBalance';

/**
 * Catalog paths of what a field can say: the account validation messages live in the `accounts`
 * namespace, the duplicate-name answer is shared with the API errors in `errors`.
 */
export type AccountFieldMessage =
  | 'accounts.errors.nameRequired'
  | 'accounts.errors.nameTooLong'
  | 'accounts.errors.typeRequired'
  | 'accounts.errors.currencyRequired'
  | 'accounts.errors.amountInvalid'
  | 'errors.accountNameTaken';

/** One message above the form and/or one message per field, like the auth forms. */
export interface AccountFormErrors {
  form?: ErrorMessageKey;
  fields?: Partial<Record<AccountFieldName, AccountFieldMessage>>;
}

/** Why the shared name schema refused `name`: nothing left after trimming, or too many characters. */
export function nameErrorMessage(name: string): AccountFieldMessage {
  const length = Array.from(name.normalize('NFC').trim()).length;
  return length > ACCOUNT_NAME_MAX_LENGTH
    ? 'accounts.errors.nameTooLong'
    : 'accounts.errors.nameRequired';
}
