import type { AccountCurrency } from '@pesly/shared';

/** Minor-unit strings per currency, as the API sends the account totals. */
export type CurrencyTotals = Partial<Record<AccountCurrency, string>>;
