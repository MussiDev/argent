import { sql } from 'drizzle-orm';
import type { RateRepository } from '../../application/ports/rate-repository';
import type { RateQuote, StoredRate } from '../../domain/rate-quote';
import type { Database } from '../../../shared/db/client';
import { exchangeRates } from './schema';

export class DrizzleRateRepository implements RateRepository {
  constructor(private readonly db: Database) {}

  async replaceAll(quotes: readonly RateQuote[], fetchedAt: Date): Promise<void> {
    if (quotes.length === 0) return;
    // One statement, so readers see the old set or the new set and a failure keeps the old one.
    await this.db
      .insert(exchangeRates)
      .values(quotes.map((quote) => ({ ...quote, fetchedAt })))
      .onConflictDoUpdate({
        target: exchangeRates.rateType,
        set: {
          buy: sql`excluded.buy`,
          sell: sql`excluded.sell`,
          providerUpdatedAt: sql`excluded.provider_updated_at`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }

  async findAll(): Promise<StoredRate[]> {
    return this.db.select().from(exchangeRates);
  }
}
