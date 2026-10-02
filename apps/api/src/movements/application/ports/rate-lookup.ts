import type { RateType } from '@pesly/shared';

/** Reads the stored rates only; it never calls a provider. `null` when none is stored. */
export interface RateLookup {
  latestSell(rateType: RateType): Promise<{ sell: bigint } | null>;
}
