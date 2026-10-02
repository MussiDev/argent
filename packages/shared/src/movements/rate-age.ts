import type { ExchangeRate } from '../exchange-rates/exchange-rate';

/** Which timestamp of a stored rate its age is measured from. Changing it is this one line. */
export const RATE_AGE_BASIS = 'fetchedAt' satisfies keyof ExchangeRate;

/** A rate older than this shows a warning on the entry screen. */
export const RATE_AGE_WARNING_MS = 2 * 60 * 60 * 1000;

export function rateAgeMs(
  rate: Pick<ExchangeRate, 'fetchedAt' | 'providerUpdatedAt'>,
  now: Date,
): number {
  return now.getTime() - Date.parse(rate[RATE_AGE_BASIS]);
}
