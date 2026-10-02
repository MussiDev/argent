import type { RateQuote, StoredRate } from '../../domain/rate-quote';

export interface RateRepository {
  /** Atomic: readers see the old set or the new set, never a mix. */
  replaceAll(quotes: readonly RateQuote[], fetchedAt: Date): Promise<void>;
  findAll(): Promise<StoredRate[]>;
}
