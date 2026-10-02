import { exactIntegerStringSchema, formatMoney, type AccountCurrency } from '@pesly/shared';

/** A minor-unit string from the API (any size) formatted for the locale. */
export function formatAmount(amount: string, currency: AccountCurrency, locale: string): string {
  return formatMoney(BigInt(exactIntegerStringSchema.parse(amount)), currency, locale);
}
