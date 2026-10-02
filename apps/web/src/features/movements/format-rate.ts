import { formatScaledRate } from '@pesly/shared';

/**
 * A rate scaled by 10,000 for display: 2 to 4 decimals in the locale's notation. The exact decimal
 * string goes to Intl, so no float is created.
 */
export function formatRate(value: bigint, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(formatScaledRate(value) as `${number}`);
}
