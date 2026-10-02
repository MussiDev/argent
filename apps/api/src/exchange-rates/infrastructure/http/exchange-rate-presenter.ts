import type { LatestRatesResponse } from '@pesly/shared';
import type { StoredRate } from '../../domain/rate-quote';

/** The only place where scaled `bigint` rates become decimal integer strings and dates ISO strings. */
export function presentLatestRates(rates: readonly StoredRate[]): LatestRatesResponse {
  return {
    rates: rates.map((rate) => ({
      rateType: rate.rateType,
      buy: rate.buy.toString(),
      sell: rate.sell.toString(),
      providerUpdatedAt: rate.providerUpdatedAt.toISOString(),
      fetchedAt: rate.fetchedAt.toISOString(),
    })),
  };
}
