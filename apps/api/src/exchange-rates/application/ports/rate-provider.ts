import type { RateQuote } from '../../domain/rate-quote';

/** Fetches the current quotes; failures surface as `RateProviderFailure`. */
export interface RateProvider {
  fetchQuotes(): Promise<RateQuote[]>;
}
