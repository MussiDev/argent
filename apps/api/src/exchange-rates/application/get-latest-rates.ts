import { RATE_TYPES } from '@pesly/shared';
import type { StoredRate } from '../domain/rate-quote';
import type { RateRepository } from './ports/rate-repository';

export interface GetLatestRatesDependencies {
  rates: RateRepository;
}

export class GetLatestRates {
  constructor(private readonly deps: GetLatestRatesDependencies) {}

  async execute(): Promise<StoredRate[]> {
    const rows = await this.deps.rates.findAll();
    return [...rows].sort(
      (a, b) => RATE_TYPES.indexOf(a.rateType) - RATE_TYPES.indexOf(b.rateType),
    );
  }
}
