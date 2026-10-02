import type { RateType } from '@pesly/shared';
import { eq } from 'drizzle-orm';
import type { RateLookup } from '../../application/ports/rate-lookup';
import type { Database } from '../../../shared/db/client';
import { exchangeRates } from './foreign-relations';

/** Reads the stored row only; the table keeps one row per rate type. */
export class DrizzleRateLookup implements RateLookup {
  constructor(private readonly db: Database) {}

  async latestSell(rateType: RateType): Promise<{ sell: bigint } | null> {
    const [row] = await this.db
      .select({ sell: exchangeRates.sell })
      .from(exchangeRates)
      .where(eq(exchangeRates.rateType, rateType))
      .limit(1);
    return row ?? null;
  }
}
