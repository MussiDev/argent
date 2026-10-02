import { RATE_MAX_SCALED, RATE_TYPES, type RateType } from '@pesly/shared';
import { RateProviderFailure } from './errors';

/** Buy and sell are ARS per USD scaled by 10,000. */
export interface RateQuote {
  rateType: RateType;
  buy: bigint;
  sell: bigint;
  providerUpdatedAt: Date;
}

export interface StoredRate extends RateQuote {
  fetchedAt: Date;
}

function isValidPrice(price: bigint): boolean {
  return price >= 1n && price <= RATE_MAX_SCALED;
}

/** Requires each of the 7 rate types exactly once with valid prices; returns them in RATE_TYPES order. */
export function assertCompleteQuotes(quotes: readonly RateQuote[]): RateQuote[] {
  const byType = new Map<RateType, RateQuote>();
  for (const quote of quotes) {
    if (byType.has(quote.rateType)) {
      throw new RateProviderFailure('provider_invalid_payload', {
        detail: `duplicate rate type ${quote.rateType}`,
      });
    }
    if (!isValidPrice(quote.buy) || !isValidPrice(quote.sell)) {
      throw new RateProviderFailure('provider_invalid_payload', {
        detail: `invalid price for ${quote.rateType}`,
      });
    }
    byType.set(quote.rateType, quote);
  }

  return RATE_TYPES.map((rateType) => {
    const quote = byType.get(rateType);
    if (!quote) {
      throw new RateProviderFailure('provider_invalid_payload', {
        detail: `missing rate type ${rateType}`,
      });
    }
    return quote;
  });
}
