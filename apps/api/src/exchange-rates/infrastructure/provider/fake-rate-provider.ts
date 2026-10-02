import type { RateProvider } from '../../application/ports/rate-provider';
import type { RateQuote } from '../../domain/rate-quote';
import type { RateProviderFailure } from '../../domain/errors';

const FAKE_UPDATED_AT = new Date('2026-10-02T11:56:00.000Z');

// Same values as the 2026-10-02 dolarapi fixture, scaled by 10,000.
const FAKE_PRICES: readonly (readonly [RateQuote['rateType'], bigint, bigint])[] = [
  ['oficial', 14_950_000n, 15_450_000n],
  ['blue', 15_350_000n, 15_550_000n],
  ['mep', 15_470_000n, 15_560_000n],
  ['ccl', 16_233_000n, 16_248_000n],
  ['mayorista', 15_140_000n, 15_230_000n],
  ['cripto', 16_140_300n, 16_182_400n],
  ['tarjeta', 19_435_000n, 20_085_000n],
];

/** Deterministic, offline stand-in for dolarapi (`RATE_PROVIDER=fake`); never used in production. */
export class FakeRateProvider implements RateProvider {
  private failure: RateProviderFailure | undefined;

  failWith(failure: RateProviderFailure): void {
    this.failure = failure;
  }

  recover(): void {
    this.failure = undefined;
  }

  fetchQuotes(): Promise<RateQuote[]> {
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(
      FAKE_PRICES.map(([rateType, buy, sell]) => ({
        rateType,
        buy,
        sell,
        providerUpdatedAt: new Date(FAKE_UPDATED_AT),
      })),
    );
  }
}
